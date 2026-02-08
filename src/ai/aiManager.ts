import * as vscode from "vscode";
import { config } from "../config";
import { AIProvider, AIOptions, AIModelInfo } from "./types";
import { ClaudeProvider } from "./providers/claude";
import { OpenAIProvider } from "./providers/openai";
import { CopilotProvider } from "./providers/copilot";
import { AuthManager } from "../auth/authManager";

export class AIManager implements vscode.Disposable {
  private static readonly providerIds = ["claude", "openai", "copilot"] as const;
  private providers: Map<string, AIProvider> = new Map();
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel, authManager: AuthManager) {
    this.outputChannel = outputChannel;

    // Register all providers
    this.providers.set("claude", new ClaudeProvider(authManager, outputChannel));
    this.providers.set("openai", new OpenAIProvider(authManager));
    this.providers.set("copilot", new CopilotProvider());
  }

  async generateCommitMessage(diff: string): Promise<string> {
    const provider = this.getActiveProvider();
    if (!provider) {
      throw new Error("No AI provider configured. Run 'GitDoc AI: Select AI Provider' to choose one.");
    }

    // Pre-flight: verify credentials exist before making API call
    this.log(`Checking if ${provider.name} is available...`);
    const available = await provider.isAvailable();
    this.log(
      `Availability result for ${provider.name}: ${available} (provider=${provider.id}, authMethod=${
        provider.id === "copilot" ? "n/a" : config.getAuthMethodForProvider(provider.id as "claude" | "openai")
      })`,
      "debug"
    );
    if (!available) {
      throw new Error(
        `${provider.name} credentials not found. Run 'GitDoc AI: Sign In' or 'GitDoc AI: Set API Key' to configure. See GitDoc AI Output for detailed auth diagnostics.`
      );
    }

    const model = this.resolveModelForProvider(provider.id);
    const options: AIOptions = {
      customInstructions: config.aiCustomInstructions,
      useEmojis: config.aiUseEmojis,
      model,
      maxDiffChars: config.aiMaxDiffChars,
      commitMessageStyle: config.commitMessageStyle,
      commitMessageLength: config.commitMessageLength,
    };

    this.log(
      `Generating commit message with ${provider.name} (model: ${model || "default"}, diff: ${diff.length} chars, timeout: ${config.aiRequestTimeoutMs}ms)...`
    );
    const message = await this.withTimeout(
      provider.generateCommitMessage(diff, options),
      config.aiRequestTimeoutMs,
      provider.name
    );
    this.log(`Generated commit message: "${message}"`);

    return message;
  }

  getActiveProvider(): AIProvider | undefined {
    const selected = config.aiProvider;
    if (config.isProviderEnabled(selected)) {
      return this.providers.get(selected);
    }

    for (const providerId of AIManager.providerIds) {
      if (config.isProviderEnabled(providerId)) {
        this.log(
          `Configured provider '${selected}' is disabled; falling back to '${providerId}'.`
        );
        return this.providers.get(providerId);
      }
    }

    this.log("No enabled AI providers are configured.");
    return undefined;
  }

  async isProviderAvailable(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (!provider) return false;
    return provider.isAvailable();
  }

  async listModels(providerId?: string): Promise<AIModelInfo[]> {
    const resolvedProviderId = providerId || this.getActiveProvider()?.id;
    if (!resolvedProviderId) {
      return [];
    }

    const provider = this.providers.get(resolvedProviderId);
    if (!provider?.listModels) {
      return [];
    }

    const models = await provider.listModels();
    return this.sortModels(models);
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys()).filter((providerId) => {
      if (!this.isKnownProviderId(providerId)) {
        return false;
      }
      return config.isProviderEnabled(providerId);
    });
  }

  private log(message: string, level: "error" | "info" | "debug" = "info"): void {
    if (!this.shouldLog(level)) {
      return;
    }
    this.outputChannel.appendLine(`[AI] [${level.toUpperCase()}] ${message}`);
  }

  private shouldLog(level: "error" | "info" | "debug"): boolean {
    const weights = { error: 0, info: 1, debug: 2 } as const;
    return weights[level] <= weights[config.logLevel];
  }

  private resolveModelForProvider(providerId: string): string | undefined {
    // Backward-compatible override: this setting wins if set.
    if (config.aiModel.trim().length > 0) {
      return config.aiModel.trim();
    }

    switch (providerId) {
      case "claude":
        return config.aiClaudeModel.trim() || undefined;
      case "openai":
        return config.aiOpenAIModel.trim() || undefined;
      case "copilot":
        return config.aiCopilotModel.trim() || undefined;
      default:
        return undefined;
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    providerName: string
  ): Promise<T> {
    const clampedTimeout = Math.max(10000, timeoutMs);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new Error(
                `${providerName} request timed out after ${clampedTimeout}ms`
              )
            );
          }, clampedTimeout);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private isKnownProviderId(
    providerId: string
  ): providerId is (typeof AIManager.providerIds)[number] {
    return AIManager.providerIds.some((id) => id === providerId);
  }

  private sortModels(models: AIModelInfo[]): AIModelInfo[] {
    return [...models].sort((a, b) => {
      const aCreated = a.createdAtMs ?? 0;
      const bCreated = b.createdAtMs ?? 0;
      if (aCreated !== bCreated) {
        return bCreated - aCreated;
      }
      return 0;
    });
  }

  dispose(): void {
    for (const provider of this.providers.values()) {
      if (provider.dispose) {
        provider.dispose();
      }
    }
  }
}
