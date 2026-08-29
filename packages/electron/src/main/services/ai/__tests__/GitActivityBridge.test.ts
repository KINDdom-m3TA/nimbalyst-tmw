import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: { main: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } },
}));

import { GitActivityBridge, interpretToolResult } from '../GitActivityBridge';
import type { GitOperationLogService } from '../../GitOperationLogService';

function fakeLog() {
  return {
    startExternal: vi.fn().mockResolvedValue(undefined),
    finishExternal: vi.fn().mockResolvedValue(undefined),
    interruptExternal: vi.fn().mockResolvedValue(undefined),
  };
}

let log: ReturnType<typeof fakeLog>;
let bridge: GitActivityBridge;

beforeEach(() => {
  log = fakeLog();
  bridge = new GitActivityBridge(
    log as unknown as GitOperationLogService,
    'session-1',
    'openai-codex',
  );
});

describe('GitActivityBridge', () => {
  it('records a git command once across a start event and a completion event', async () => {
    // Codex emits item.started then item.completed for one command_execution;
    // a second start must upsert the same entry, not open a phantom.
    await bridge.observe({
      command: 'git fetch origin',
      workspacePath: '/repo',
      providerToolCallId: 'nimtc|abc|1|0',
      result: undefined,
    });
    await bridge.observe({
      command: 'git fetch origin',
      workspacePath: '/repo',
      providerToolCallId: 'nimtc|abc|1|0',
      result: { exitCode: 0, stdout: 'From origin\n' },
    });

    expect(log.startExternal).toHaveBeenCalledTimes(1);
    expect(log.startExternal.mock.calls[0][0]).toMatchObject({
      workspacePath: '/repo',
      source: 'agent',
      sessionId: 'session-1',
      provider: 'openai-codex',
    });
    expect(log.finishExternal).toHaveBeenCalledTimes(1);
    expect(log.finishExternal.mock.calls[0][0]).toMatchObject({ success: true, exitCode: 0 });
  });

  it('ignores a repeated terminal event for a command that already settled', async () => {
    const observation = {
      command: 'git status',
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      result: 'On branch main',
    };
    await bridge.observe(observation);
    await bridge.observe(observation);

    expect(log.finishExternal).toHaveBeenCalledTimes(1);
  });

  it('does not record a command that only mentions git', async () => {
    await bridge.observe({
      command: 'npm test && echo "git push"',
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      result: undefined,
    });

    expect(log.startExternal).not.toHaveBeenCalled();
  });

  it('attaches the entry to the worktree the command targeted', async () => {
    await bridge.observe({
      command: 'git diff --stat',
      workspacePath: '/repo/.worktrees/feature',
      providerToolCallId: 'call-1',
      result: undefined,
    });

    expect(log.startExternal.mock.calls[0][0].workspacePath).toBe('/repo/.worktrees/feature');
  });

  it('interrupts a command whose completion never arrived', async () => {
    await bridge.observe({
      command: 'git push origin main',
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      result: undefined,
    });

    await bridge.interruptOutstanding('cancelled');

    expect(log.interruptExternal).toHaveBeenCalledTimes(1);
    expect(log.interruptExternal.mock.calls[0][0]).toMatchObject({
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      reason: 'cancelled',
    });
  });

  it('leaves an already-settled command alone when the turn ends', async () => {
    await bridge.observe({
      command: 'git status',
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      result: { exitCode: 0 },
    });

    await bridge.interruptOutstanding();

    expect(log.interruptExternal).not.toHaveBeenCalled();
  });
});

describe('interpretToolResult', () => {
  it('treats a missing result as still running', () => {
    expect(interpretToolResult(undefined).terminal).toBe(false);
    expect(interpretToolResult(null).terminal).toBe(false);
  });

  it.each([
    [{ exitCode: 0, stdout: 'ok' }, true],
    [{ exitCode: 1, stderr: 'rejected' }, false],
    [{ success: false, error: 'boom' }, false],
    [{ is_error: true, content: 'nope' }, false],
    ['plain string output', true],
  ])('reads %j as success=%s', (result, success) => {
    const outcome = interpretToolResult(result);
    expect(outcome.terminal).toBe(true);
    expect(outcome.success).toBe(success);
  });

  it('carries stderr as the error only on failure', () => {
    // A successful git command routinely writes progress to stderr; surfacing
    // that as an error would mark healthy fetches red in the Output tab.
    expect(interpretToolResult({ exitCode: 0, stderr: 'Receiving objects...' }).error).toBeUndefined();
    expect(interpretToolResult({ exitCode: 128, stderr: 'not a repository' }).error).toBe(
      'not a repository',
    );
  });
});
