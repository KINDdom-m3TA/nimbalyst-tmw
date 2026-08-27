// @vitest-environment node
/**
 * Every enabled provider's catalog must actually be fetched.
 *
 * `getAllModels` used to be an if-per-provider list, and it had silently fallen
 * behind: `grok-build` and `cursor-agent` were both absent. The failure mode is
 * the quiet kind — the provider appears in Settings, its toggle works, it lands
 * in `enabledProviders`, and its model picker is simply empty, with no error
 * logged anywhere. It is now driven off `AI_PROVIDER_TYPES`, and this pins that
 * so a future provider cannot be added to the union and forgotten here.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

import { ModelRegistry } from '../ModelRegistry';
import { AI_PROVIDER_TYPES, type AIProviderType } from '../types';

afterEach(() => vi.restoreAllMocks());

describe('ModelRegistry.getAllModels', () => {
  it('fetches a catalog for every provider in the union', async () => {
    const asked: string[] = [];
    vi.spyOn(ModelRegistry, 'getModelsForProvider').mockImplementation(
      async (provider: AIProviderType) => {
        asked.push(provider);
        return [];
      },
    );

    await ModelRegistry.getAllModels({}, undefined);

    expect([...asked].sort()).toEqual([...AI_PROVIDER_TYPES].sort());
  });

  it('fetches only the enabled subset', async () => {
    const asked: string[] = [];
    vi.spyOn(ModelRegistry, 'getModelsForProvider').mockImplementation(
      async (provider: AIProviderType) => {
        asked.push(provider);
        return [];
      },
    );

    await ModelRegistry.getAllModels(
      {},
      undefined,
      new Set<AIProviderType>(['antigravity-gemini-agent', 'grok-build']),
    );

    expect([...asked].sort()).toEqual(['antigravity-gemini-agent', 'grok-build']);
  });

  it('passes each provider the API key it needs, and no key to the ones that have none', async () => {
    const calls = new Map<string, string | undefined>();
    vi.spyOn(ModelRegistry, 'getModelsForProvider').mockImplementation(
      async (provider: AIProviderType, _workspacePath, apiKey) => {
        calls.set(provider, apiKey);
        return [];
      },
    );

    await ModelRegistry.getAllModels({ anthropic: 'sk-ant', openai: 'sk-oai' }, undefined);

    expect(calls.get('claude')).toBe('sk-ant');
    expect(calls.get('openai')).toBe('sk-oai');
    expect(calls.get('openai-codex')).toBe('sk-oai');
    // Vendor-login providers must never be handed a key — the no-env-fallback
    // rule is about where keys come from, and silently passing an unrelated
    // one is the same class of mistake.
    expect(calls.get('antigravity-gemini-agent')).toBeUndefined();
    expect(calls.get('grok-build')).toBeUndefined();
    expect(calls.get('claude-code')).toBeUndefined();
  });
});
