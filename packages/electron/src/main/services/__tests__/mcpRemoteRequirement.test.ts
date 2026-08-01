import { describe, expect, it } from 'vitest';
import { requiresMcpRemote } from '../mcpRemoteRequirement';
import type { MCPServerConfig } from '@nimbalyst/runtime/types/MCPServerConfig';

const http = (extra: Partial<MCPServerConfig> = {}): MCPServerConfig =>
  ({ type: 'http', url: 'https://api.example.com/mcp', ...extra }) as MCPServerConfig;

describe('requiresMcpRemote', () => {
  it('does NOT require the wrapper for a static-header server on a native-HTTP CLI', () => {
    // The whole bug: a server authenticating with a plain bearer header needs no
    // OAuth, so mcp-remote buys nothing and costs a process tree plus a token
    // on the command line.
    const config = http({ headers: { Authorization: 'Bearer ghp_static' } });
    expect(requiresMcpRemote(config, { nativeHttpSupported: true })).toBe(false);
  });

  it('DOES require the wrapper when the CLI has no native HTTP transport', () => {
    // Codex, Codex ACP and Copilot go through the same code path and were never
    // verified. They keep the wrapper until someone measures them.
    const config = http({ headers: { Authorization: 'Bearer ghp_static' } });
    expect(requiresMcpRemote(config, { nativeHttpSupported: false })).toBe(true);
  });

  it('DOES require the wrapper when the server declares dynamic OAuth', () => {
    // No clientId/clientSecret, but an oauth block means tokens are negotiated
    // and stored by mcp-remote in ~/.mcp-auth.
    const config = http({ oauth: {} } as Partial<MCPServerConfig>);
    expect(requiresMcpRemote(config, { nativeHttpSupported: true })).toBe(true);
  });

  it('does NOT require the wrapper when OAuth credentials are supplied', () => {
    // Existing native-OAuth escape hatch, preserved.
    const config = http({ oauth: { clientId: 'abc' } } as Partial<MCPServerConfig>);
    expect(requiresMcpRemote(config, { nativeHttpSupported: true })).toBe(false);
  });

  it('never applies to stdio servers', () => {
    const config = { type: 'stdio', command: 'node', args: ['x.js'] } as MCPServerConfig;
    expect(requiresMcpRemote(config, { nativeHttpSupported: true })).toBe(false);
    expect(requiresMcpRemote(config, { nativeHttpSupported: false })).toBe(false);
  });

  it('never applies to sse servers, which are already remote-capable', () => {
    const config = { type: 'sse', url: 'http://127.0.0.1:3456/mcp/x' } as MCPServerConfig;
    expect(requiresMcpRemote(config, { nativeHttpSupported: true })).toBe(false);
  });

  it('defaults to the safe answer when nativeHttpSupported is unspecified', () => {
    // An unknown caller must keep today's behaviour, not silently lose the wrapper.
    const config = http({ headers: { Authorization: 'Bearer x' } });
    expect(requiresMcpRemote(config, {})).toBe(true);
  });
});
