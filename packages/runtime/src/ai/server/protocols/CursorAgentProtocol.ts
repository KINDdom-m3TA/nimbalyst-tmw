/**
 * Cursor Agent headless protocol adapter.
 *
 * Transport: `cursor-agent --print --output-format stream-json`, one process
 * per turn, with session continuity via `create-chat` + `--resume <chatId>`.
 *
 * The `agent acp` subcommand referenced in Cursor's docs does not exist in the
 * shipped CLI (`2026.08.25`), and would be the wrong surface regardless:
 * stream-json is the only surface of the three agents measured in Phase 0 that
 * reports a *pre-edit baseline*. `editToolCall.result.success` carries
 * `beforeFullFileContent`, `afterFullFileContent` and a unified `diffString`,
 * and `deleteToolCall.result.success.prevContent` carries the contents of a
 * file it removed. That is better data than a filesystem watcher can infer,
 * which is what earns this provider `'structured'` file-change fidelity.
 *
 * Observed record types (2026-08-26):
 *   {type:'system', subtype:'init', session_id, cwd, model, permissionMode}
 *   {type:'thinking', subtype:'delta'|'completed', text}
 *   {type:'tool_call', subtype:'started'|'completed', call_id, tool_call:{<oneof>ToolCall}}
 *   {type:'assistant', message|text}
 *   {type:'result', subtype:'success'|..., result, usage, session_id}
 */

import {
  runHeadlessNdjson,
  HeadlessNdjsonExitError,
} from './headless/HeadlessNdjsonProcess';
import type {
  AgentProtocol,
  ProtocolEvent,
  ProtocolMessage,
  ProtocolSession,
  SessionOptions,
  ToolResult,
} from './ProtocolInterface';

const PLATFORM = 'cursor-agent-headless';

/**
 * `tool_call.tool_call` is a one-of. The key names the tool; mapping it to a
 * stable display name here keeps the union out of every downstream consumer.
 */
const TOOL_CALL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  readToolCall: 'read',
  editToolCall: 'edit',
  writeToolCall: 'write',
  deleteToolCall: 'delete',
  shellToolCall: 'shell',
  lsToolCall: 'ls',
  globToolCall: 'glob',
  grepToolCall: 'grep',
  searchToolCall: 'search',
  todoToolCall: 'todo',
  mcpToolCall: 'mcp',
});

interface CursorSessionRaw extends Record<string, unknown> {
  workspacePath: string;
  model?: string;
}

export interface CursorAgentProtocolDeps {
  runNdjson?: typeof runHeadlessNdjson;
  /** Runs `cursor-agent create-chat` and returns the new chat id. */
  createChat?: (opts: { command: string; cwd: string; env?: Record<string, string> }) => Promise<string>;
}

export class CursorAgentProtocol implements AgentProtocol {
  readonly platform = PLATFORM;

  private cursorPath = 'cursor-agent';
  private processEnv: Record<string, string> | null = null;
  private readonly runNdjson: typeof runHeadlessNdjson;
  private readonly createChatImpl: NonNullable<CursorAgentProtocolDeps['createChat']>;

  constructor(deps?: CursorAgentProtocolDeps) {
    this.runNdjson = deps?.runNdjson ?? runHeadlessNdjson;
    this.createChatImpl = deps?.createChat ?? defaultCreateChat;
  }

  setCursorPath(executablePath: string): void {
    this.cursorPath = executablePath;
  }

  setProcessEnv(env: Record<string, string> | null): void {
    this.processEnv = env;
  }

  async createSession(options: SessionOptions): Promise<ProtocolSession> {
    // `create-chat` mints the id up front so the host can persist a provider
    // session id before the first turn runs. Without it the id only appears in
    // the first `system.init` record, and a turn that dies early would leave
    // the session unresumable.
    const id = await this.createChatImpl({
      command: this.cursorPath,
      cwd: options.workspacePath,
      env: this.processEnv ?? undefined,
    });
    return {
      id,
      platform: PLATFORM,
      raw: { workspacePath: options.workspacePath, model: options.model } satisfies CursorSessionRaw,
    };
  }

  async resumeSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    return {
      id: sessionId,
      platform: PLATFORM,
      raw: { workspacePath: options.workspacePath, model: options.model } satisfies CursorSessionRaw,
    };
  }

  async forkSession(_sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    // Cursor has no fork RPC. A fresh chat is the honest fallback: it starts
    // empty rather than silently sharing history with the source.
    return this.createSession(options);
  }

  async *sendMessage(
    session: ProtocolSession,
    message: ProtocolMessage,
  ): AsyncIterable<ProtocolEvent> {
    const raw = (session.raw ?? {}) as CursorSessionRaw;
    const args = this.buildArgs(session, raw, message);

    let sawResult = false;
    try {
      for await (const item of this.runNdjson({
        command: this.cursorPath,
        args,
        cwd: raw.workspacePath,
        env: this.processEnv ?? undefined,
        abortSignal: message.abortSignal,
      })) {
        if (item.kind === 'garbage') continue;
        yield { type: 'raw_event', metadata: { rawEvent: item.value } };

        for (const event of mapCursorRecord(item.value)) {
          if (event.type === 'complete') sawResult = true;
          yield event;
        }
      }
    } catch (error) {
      if (message.abortSignal?.aborted) return;
      yield { type: 'error', error: describeCursorFailure(error) };
      return;
    }

    if (!sawResult && !message.abortSignal?.aborted) {
      yield { type: 'error', error: 'Cursor ended the turn without a final result.' };
    }
  }

  abortSession(_session: ProtocolSession): void {
    // Per-turn child process; the per-message abort signal owns teardown.
  }

  cleanupSession(_session: ProtocolSession): void {
    // Cursor owns its chat storage; deleting it is not ours to do.
  }

  private buildArgs(
    session: ProtocolSession,
    raw: CursorSessionRaw,
    message: ProtocolMessage,
  ): string[] {
    const args = [
      '--resume', session.id,
      '-p', message.content,
      '--output-format', 'stream-json',
    ];
    // Stored model ids are namespaced (`cursor-agent:auto`); the CLI wants the
    // bare id.
    if (raw.model) args.push('--model', stripProviderNamespace(raw.model));
    // `--print` already grants write and shell access with no approval event
    // to intercept (measured: a run without `--force` still edited the file).
    // `--force` makes that explicit rather than leaving it implicit, and
    // `--trust` avoids a workspace prompt no one can answer headlessly.
    // Nimbalyst gates the turn up front instead; the settings panel says so.
    args.push('--force', '--trust');
    return args;
  }
}

/** Map one Cursor record onto zero or more protocol events. */
export function mapCursorRecord(record: Record<string, unknown>): ProtocolEvent[] {
  switch (record.type) {
    case 'assistant': {
      const text = extractAssistantText(record);
      return text ? [{ type: 'text', content: text }] : [];
    }

    case 'thinking': {
      if (record.subtype !== 'delta') return [];
      const text = typeof record.text === 'string' ? record.text : '';
      return text ? [{ type: 'reasoning', content: text }] : [];
    }

    case 'tool_call': {
      const toolCall = asRecord(record.tool_call);
      if (!toolCall) return [];
      const key = Object.keys(toolCall).find((k) => k in TOOL_CALL_KEYS);
      if (!key) return [];
      const name = TOOL_CALL_KEYS[key];
      const body = asRecord(toolCall[key]) ?? {};
      const id = asString(record.call_id) ?? asString(toolCall.toolCallId);

      if (record.subtype === 'started') {
        return [{
          type: 'tool_call',
          toolCall: { id, name, arguments: asRecord(body.args) ?? {} },
        }];
      }

      if (record.subtype === 'completed') {
        return [{
          type: 'tool_result',
          toolResult: { id, name, result: buildCursorToolResult(name, body) },
        }];
      }

      return [];
    }

    case 'result': {
      const usage = normalizeCursorUsage(record.usage);
      const isError = record.is_error === true;
      if (isError) {
        return [{
          type: 'error',
          error: typeof record.result === 'string' ? record.result : 'Cursor reported an error.',
        }];
      }
      return [{
        type: 'complete',
        content: typeof record.result === 'string' ? record.result : undefined,
        usage: usage ?? undefined,
        metadata: { sessionId: record.session_id, durationMs: record.duration_ms },
      }];
    }

    default:
      return [];
  }
}

/**
 * Preserve the fields that make Cursor's file tracking authoritative.
 *
 * `beforeFullFileContent` is the pre-edit baseline the snapshot cache normally
 * has to guess at, and `prevContent` is the only record that a deleted file
 * ever existed. Dropping either would silently demote this provider to the
 * watcher-inferred attribution the whole transport choice was made to avoid.
 */
function buildCursorToolResult(name: string, body: Record<string, unknown>): ToolResult {
  const result = asRecord(body.result);
  const success = result ? asRecord(result.success) : undefined;
  const args = asRecord(body.args) ?? {};

  if (!result) {
    return { success: false, error: 'Cursor returned no result for this tool call.' };
  }
  if (!success) {
    const failure = result.error ?? result.failure ?? result;
    return { success: false, error: failure, output: failure };
  }

  const base: ToolResult = { success: true, output: success };

  if (name === 'edit' || name === 'write') {
    return {
      ...base,
      changes: [{
        path: asString(success.path) ?? asString(args.path),
        kind: 'update',
        diff: asString(success.diffString),
        beforeContent: success.beforeFullFileContent ?? null,
        afterContent: success.afterFullFileContent ?? null,
      }],
    };
  }

  if (name === 'delete') {
    return {
      ...base,
      changes: [{
        path: asString(success.deletedFile) ?? asString(success.path) ?? asString(args.path),
        kind: 'delete',
        beforeContent: success.prevContent ?? null,
        afterContent: null,
      }],
    };
  }

  if (name === 'shell') {
    return {
      ...base,
      command: asString(args.command),
      exit_code: typeof success.exitCode === 'number' ? success.exitCode : undefined,
    };
  }

  return base;
}

function extractAssistantText(record: Record<string, unknown>): string {
  if (typeof record.text === 'string') return record.text;
  const message = asRecord(record.message);
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (asRecord(part)?.type === 'text' ? String(asRecord(part)?.text ?? '') : ''))
    .join('');
}

/**
 * Cursor reports cumulative counts with no context-window size, so there is no
 * honest fill percentage to derive — `contextReporting: 'token-counts'`.
 */
function normalizeCursorUsage(value: unknown): ProtocolEvent['usage'] | null {
  const usage = asRecord(value);
  if (!usage) return null;
  const input = numberOr(usage.inputTokens, 0);
  const output = numberOr(usage.outputTokens, 0);
  if (input === 0 && output === 0) return null;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}

function stripProviderNamespace(modelId: string): string {
  const separator = modelId.indexOf(':');
  return separator === -1 ? modelId : modelId.slice(separator + 1);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function defaultCreateChat(opts: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
}): Promise<string> {
  const { execFile } = await import('child_process');
  return new Promise<string>((resolve, reject) => {
    // An explicit callback rather than promisify(execFile): a `promisify.custom`
    // on the mocked module would bypass the spy at test boundaries.
    execFile(
      opts.command,
      ['create-chat'],
      { cwd: opts.cwd, env: opts.env, timeout: 30_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const id = String(stdout).trim().split('\n').pop()?.trim();
        if (!id) {
          reject(new Error('cursor-agent create-chat returned no chat id'));
          return;
        }
        resolve(id);
      },
    );
  });
}

function describeCursorFailure(error: unknown): string {
  if (error instanceof HeadlessNdjsonExitError) {
    const stderr = error.stderr.toLowerCase();
    if (/not logged in|unauthorized|authentication/.test(stderr)) {
      return 'Cursor is not logged in. Run `cursor-agent login` in your terminal, then try again.';
    }
    return error.message;
  }
  const messageText = error instanceof Error ? error.message : String(error);
  if (/ENOENT|spawn/i.test(messageText)) {
    return 'The Cursor CLI was not found. Install it with:\n\n'
      + '  curl -fsSL https://cursor.com/install | bash\n\n'
      + 'Then run `cursor-agent login` to authenticate.';
  }
  return messageText;
}
