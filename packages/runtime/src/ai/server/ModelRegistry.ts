/**
 * Registry of available AI models with dynamic fetching
 */

import {
  AIModel,
  AIProviderType,
  AI_PROVIDER_TYPES,
  ModelIdentifier,
  assertExhaustiveProvider,
} from './types';

/**
 * Which `apiKeys` entry (if any) a provider's catalog fetch needs.
 *
 * `null` means the provider authenticates through its own CLI or vendor app
 * login and Nimbalyst holds no key for it — which is most agent providers, and
 * is deliberate: reading a key from anywhere but explicit settings is the
 * standing no-env-fallback rule.
 *
 * Exhaustive on purpose. This table is what makes `getAllModels` total.
 */
const PROVIDER_API_KEY_SOURCE: Readonly<Record<AIProviderType, string | null>> = Object.freeze({
  claude: 'anthropic',
  openai: 'openai',
  'openai-codex': 'openai',
  'openai-codex-acp': 'openai',

  // Its base URL travels separately, as the fourth argument.
  lmstudio: null,

  'claude-code': null,
  'claude-code-cli': null,
  opencode: null,
  'copilot-cli': null,
  'grok-build': null,
  'cursor-agent': null,
  'antigravity-gemini-agent': null,
});

export class ModelRegistry {
  private static cachedModels: Map<AIProviderType, AIModel[]> = new Map();
  private static lastFetch: Map<AIProviderType, number> = new Map();
  private static CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

  /**
   * Get models for a specific provider (with caching).
   *
   * `workspacePath` is required but accepts `undefined`: OpenCode resolves its
   * provider set from project config, so omitting the workspace silently
   * downgrades that lane to hardcoded presets. Making it a required positional
   * turns "I forgot" into a compile error and leaves "I genuinely have no
   * project here" as something a caller has to write down (#1382).
   */
  static async getModelsForProvider(
    provider: AIProviderType,
    workspacePath: string | undefined,
    apiKey?: string,
    baseUrl?: string
  ): Promise<AIModel[]> {
    // console.log('[ModelRegistry] getModelsForProvider called:', {
    //   provider,
    //   hasApiKey: !!apiKey,
    //   baseUrl
    // });

    // SKIP CACHE FOR NOW - always fetch fresh
    // const lastFetchTime = this.lastFetch.get(provider) || 0;
    // const cached = this.cachedModels.get(provider);

    // if (cached && Date.now() - lastFetchTime < this.CACHE_DURATION) {
    //   return cached;
    // }

    // Extension-contributed agent providers supply their models via the
    // AgentProviderRegistry (surfaced in AIService.ai:getModels), not this
    // built-in registry. Short-circuit so the exhaustive switch below does not
    // log a spurious "Unhandled provider" error for them.
    if (ModelIdentifier.isExtensionProvider(provider)) {
      return [];
    }

    // Fetch fresh models
    let models: AIModel[] = [];

    try {
      switch (provider) {
        case 'claude':
          const { ClaudeProvider } = await import('./providers/ClaudeProvider');
          models = this.filterLatestClaudeModels(ClaudeProvider.getModels());
          // console.log('[ModelRegistry] Claude models:', models);
          break;
        case 'claude-code':
          // Use SDK version with dynamic loading
          // console.log('[ModelRegistry] Fetching claude-code models via ClaudeCodeProvider.getModels()');
          const { ClaudeCodeProvider } = await import('./providers/ClaudeCodeProvider');
          models = await ClaudeCodeProvider.getModels();
          // console.log('[ModelRegistry] Claude Code models retrieved:', models.map(m => ({ id: m.id, name: m.name })));
          break;
        case 'claude-code-cli':
          const { ClaudeCodeCliProvider } = await import('./providers/ClaudeCodeCliProvider');
          models = await ClaudeCodeCliProvider.getModels();
          break;
        case 'openai':
          const { OpenAIProvider } = await import('./providers/OpenAIProvider');
          models = await OpenAIProvider.getModels(apiKey);
          break;
        case 'openai-codex':
          const { OpenAICodexProvider } = await import('./providers/OpenAICodexProvider');
          models = await OpenAICodexProvider.getModels(apiKey);
          break;
        case 'openai-codex-acp':
          const { OpenAICodexACPProvider } = await import('./providers/OpenAICodexACPProvider');
          models = await OpenAICodexACPProvider.getModels(apiKey);
          break;
        case 'opencode':
          const { OpenCodeProvider } = await import('./providers/OpenCodeProvider');
          models = await OpenCodeProvider.getModels(workspacePath);
          break;
        case 'lmstudio':
          // Try to fetch models from LMStudio
          // The provider will return empty array if LMStudio is not running
          const { LMStudioProvider } = await import('./providers/LMStudioProvider');
          models = await LMStudioProvider.getModels(baseUrl || 'http://127.0.0.1:1234');
          break;
        case 'copilot-cli':
          const { CopilotCLIProvider } = await import('./providers/CopilotCLIProvider');
          models = await CopilotCLIProvider.getModels();
          break;
        case 'grok-build':
          const { GrokBuildProvider } = await import('./providers/GrokBuildProvider');
          models = await GrokBuildProvider.getModels();
          break;
        case 'cursor-agent':
          const { CursorAgentProvider } = await import('./providers/CursorAgentProvider');
          models = await CursorAgentProvider.getModels();
          break;
        case 'antigravity-gemini-agent':
          const { GeminiAntigravityProvider } = await import('./providers/GeminiAntigravityProvider');
          models = await GeminiAntigravityProvider.getModels();
          break;
        default:
          assertExhaustiveProvider(provider);
      }

      // Update cache
      this.cachedModels.set(provider, models);
      this.lastFetch.set(provider, Date.now());

    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
      // Return empty array on error
      models = [];
    }

    return models;
  }

  /**
   * Get all available models across all providers.
   * @param apiKeys - API keys and config (e.g., anthropic, openai, lmstudio_url)
   * @param workspacePath - The project this listing is for, or `undefined` for a
   *   host with no project context. Required positionally; see
   *   getModelsForProvider() for why (#1382).
   * @param enabledProviders - Optional set of enabled provider types. If provided, only these providers are fetched.
   */
  static async getAllModels(
    apiKeys: Record<string, string>,
    workspacePath: string | undefined,
    enabledProviders?: Set<AIProviderType>
  ): Promise<AIModel[]> {
    const allModels: AIModel[] = [];

    // Iterating AI_PROVIDER_TYPES against an exhaustive key table, rather than
    // an if-per-provider list, because the list silently omitted providers.
    // `grok-build` and `cursor-agent` were both missing: enabling either put it
    // in Settings and in `enabledProviders` while its catalog was never
    // fetched, so its models never reached the picker and nothing anywhere
    // reported a problem. `Record<AIProviderType, ...>` makes the next addition
    // a compile error instead.
    const promises = AI_PROVIDER_TYPES
      .filter((provider) => !enabledProviders || enabledProviders.has(provider))
      .map((provider) => {
        const key = PROVIDER_API_KEY_SOURCE[provider];
        return this.getModelsForProvider(
          provider,
          workspacePath,
          key ? apiKeys[key] : undefined,
          provider === 'lmstudio' ? apiKeys['lmstudio_url'] : undefined,
        );
      });

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allModels.push(...result.value);
      }
    }

    return allModels;
  }

  /**
   * Get the default model for a provider
   */
  static async getDefaultModel(provider: AIProviderType): Promise<string> {
    if (ModelIdentifier.isExtensionProvider(provider)) {
      // Extension providers have no built-in default; the picker uses the
      // provider's own model list from ai:getModels.
      return '';
    }
    switch (provider) {
      case 'claude':
        const { ClaudeProvider } = await import('./providers/ClaudeProvider');
        return ClaudeProvider.getDefaultModel();
      case 'openai':
        const { OpenAIProvider } = await import('./providers/OpenAIProvider');
        return OpenAIProvider.getDefaultModel();
      case 'claude-code':
        const { ClaudeCodeProvider } = await import('./providers/ClaudeCodeProvider');
        return ClaudeCodeProvider.getDefaultModel();
      case 'claude-code-cli':
        const { ClaudeCodeCliProvider } = await import('./providers/ClaudeCodeCliProvider');
        return ClaudeCodeCliProvider.getDefaultModel();
      case 'openai-codex':
        const { OpenAICodexProvider } = await import('./providers/OpenAICodexProvider');
        return OpenAICodexProvider.getDefaultModel();
      case 'openai-codex-acp':
        const { OpenAICodexACPProvider } = await import('./providers/OpenAICodexACPProvider');
        return OpenAICodexACPProvider.getDefaultModel();
      case 'opencode':
        const { OpenCodeProvider: OCP } = await import('./providers/OpenCodeProvider');
        return OCP.DEFAULT_MODEL;
      case 'lmstudio':
        const { LMStudioProvider } = await import('./providers/LMStudioProvider');
        return LMStudioProvider.getDefaultModel();
      case 'copilot-cli':
        const { CopilotCLIProvider: CLP } = await import('./providers/CopilotCLIProvider');
        return CLP.getDefaultModel();
      case 'grok-build':
        const { GrokBuildProvider: GBP } = await import('./providers/GrokBuildProvider');
        return GBP.getDefaultModel();
      case 'cursor-agent':
        const { CursorAgentProvider: CAP } = await import('./providers/CursorAgentProvider');
        return CAP.getDefaultModel();
      case 'antigravity-gemini-agent':
        const { GeminiAntigravityProvider: GAP } = await import('./providers/GeminiAntigravityProvider');
        return GAP.getDefaultModel();
      default:
        assertExhaustiveProvider(provider);
    }
  }

  /**
   * Already-fetched catalog for a provider, or undefined if nothing has been
   * fetched yet.
   *
   * Read-only and synchronous on purpose: callers on a hot path (the per-turn
   * system prompt wants a model's display name) must not trigger a network call
   * or a CLI spawn just to prettify a string. An empty cache means "not known
   * yet", and the caller degrades rather than waits.
   */
  static getCachedModels(provider: AIProviderType): AIModel[] | undefined {
    return this.cachedModels.get(provider);
  }

  /**
   * Clear the cache to force fresh fetch
   */
  static clearCache(provider?: AIProviderType): void {
    if (provider) {
      this.cachedModels.delete(provider);
      this.lastFetch.delete(provider);
    } else {
      this.cachedModels.clear();
      this.lastFetch.clear();
    }
  }

  private static filterLatestClaudeModels(models: AIModel[]): AIModel[] {
    const latestByVariant = new Map<string, { model: AIModel; releaseDate: number }>();
    let parseFailed = false;

    for (const model of models) {
      const metadata = this.extractClaudeModelMetadata(model);
      if (!metadata) {
        parseFailed = true;
        break;
      }

      const existing = latestByVariant.get(metadata.variant);
      if (!existing || metadata.releaseDate > existing.releaseDate) {
        latestByVariant.set(metadata.variant, { model, releaseDate: metadata.releaseDate });
      }
    }

    if (parseFailed) {
      console.warn('[ModelRegistry] Failed to parse Claude model metadata - returning full list');
      return models;
    }

    return Array.from(latestByVariant.values()).map(entry => entry.model);
  }

  private static extractClaudeModelMetadata(model: AIModel): { variant: string; releaseDate: number } | null {
    // Extract the model part using ModelIdentifier
    const parsed = ModelIdentifier.tryParse(model.id);
    const idPart = parsed ? parsed.model : model.id;
    const normalized = idPart.toLowerCase();
    const variantMatch = normalized.match(/(opus|sonnet|haiku)/);
    const dateMatch = normalized.match(/(\d{8})$/);

    if (!variantMatch || !dateMatch) {
      return null;
    }

    return {
      variant: variantMatch[1],
      releaseDate: Number.parseInt(dateMatch[1], 10)
    };
  }
}
