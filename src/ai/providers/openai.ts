import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import OpenAI from "openai";
import { AIProvider, AIOptions, AIModelInfo } from "../types";
import { DEFAULT_OPENAI_MODEL, DEFAULT_CODEX_MODEL, EXTENSION_ID } from "../../constants";
import { AuthManager } from "../../auth/authManager";
import { config } from "../../config";
import {
  buildCommitSystemPrompt,
  normalizeCommitMessage,
  truncateDiffForAI,
} from "../prompt";

const execFileAsync = promisify(execFile);

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAI";
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
  }

  async isAvailable(): Promise<boolean> {
    if (config.getAuthMethodForProvider("openai") === "login") {
      return this.authManager.hasOpenAICodexAuth();
    }

    const apiKey = await this.authManager.getOpenAIApiKey();
    return !!apiKey;
  }

  async generateCommitMessage(diff: string, options: AIOptions): Promise<string> {
    if (config.getAuthMethodForProvider("openai") === "login") {
      return this.generateWithCodex(diff, options);
    }

    return this.generateWithApiKey(diff, options);
  }

  async listModels(): Promise<AIModelInfo[]> {
    const fallback = this.getFallbackModels();
    const apiKey = await this.authManager.getOpenAIApiKey();
    if (!apiKey) {
      return fallback;
    }

    try {
      const client = new OpenAI({ apiKey });
      const response = await client.models.list();
      const models = response.data
        .filter((model) => this.isLikelyChatModel(model.id))
        .map((model) => ({
          id: model.id,
          createdAtMs:
            typeof model.created === "number" ? model.created * 1000 : undefined,
        }))
        .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

      return this.uniqueModels(models.length > 0 ? models : fallback);
    } catch {
      return fallback;
    }
  }

  private async generateWithApiKey(
    diff: string,
    options: AIOptions
  ): Promise<string> {
    const apiKey = (await this.authManager.getOpenAIApiKey()) || process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OpenAI API key not configured. Use 'GitDoc AI: Set OpenAI API Key' or set the OPENAI_API_KEY environment variable.");
    }

    const client = new OpenAI({
      apiKey,
      timeout: Math.max(5000, config.aiRequestTimeoutMs),
    });
    const model = options.model || DEFAULT_OPENAI_MODEL;
    const truncatedDiff = truncateDiffForAI(diff, options);
    const systemPrompt = buildCommitSystemPrompt(options);

    const response = await client.chat.completions.create({
      model,
      max_tokens: 200,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate a commit message for the following git diff:\n\n${truncatedDiff}`,
        },
      ],
    });

    const message = response.choices[0]?.message?.content;
    if (!message) {
      throw new Error("No response from OpenAI");
    }

    return normalizeCommitMessage(message);
  }

  private async generateWithCodex(
    diff: string,
    options: AIOptions
  ): Promise<string> {
    const truncatedDiff = truncateDiffForAI(diff, options);
    const systemPrompt = buildCommitSystemPrompt(options);

    const prompt = `${systemPrompt}

Generate a commit message for the following git diff:

${truncatedDiff}`;

    // Only pass --model if the user explicitly configured one.
    // Codex CLI with ChatGPT accounts only supports specific models;
    // letting Codex pick its own default is the safest option.
    const explicitModel = this.getExplicitlyConfiguredModel();

    if (explicitModel) {
      try {
        return await this.execCodex(prompt, explicitModel);
      } catch (error: any) {
        // If the explicit model is rejected, retry without --model
        const msg = String(error?.message || "");
        if (msg.includes("not supported") || msg.includes("not available") || msg.includes("invalid model")) {
          return await this.execCodex(prompt);
        }
        throw error;
      }
    }

    // No explicit model — let Codex CLI use its own default
    return await this.execCodex(prompt);
  }

  private async execCodex(prompt: string, model?: string): Promise<string> {
    const args = ["exec"];
    if (model) {
      args.push("--model", model);
    }
    args.push(prompt);

    try {
      const cwd =
        vscode.window.activeTextEditor?.document.uri.fsPath
          ? vscode.workspace.getWorkspaceFolder(
              vscode.window.activeTextEditor.document.uri
            )?.uri.fsPath
          : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      // CLI needs extra time for process startup, auth check, etc.
      const cliTimeout = Math.max(15000, Math.round(config.aiRequestTimeoutMs * 1.5));
      const { stdout, stderr } = await execFileAsync("codex", args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: cliTimeout,
      });
      const response = stdout.trim();
      if (!response) {
        throw new Error(stderr?.toString().trim() || "No response from Codex");
      }
      return normalizeCommitMessage(response);
    } catch (error: any) {
      const errorMessage = error?.stderr?.toString().trim() || error.message;
      throw new Error(
        `Codex CLI error: ${errorMessage}. Ensure 'codex login' is complete and Codex CLI is installed.`
      );
    }
  }

  /**
   * Returns the model ONLY if the user explicitly configured it
   * (i.e. not just the package.json default). Uses VS Code's inspect()
   * API to distinguish explicit user settings from defaults.
   */
  private getExplicitlyConfiguredModel(): string | undefined {
    const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);

    // Global model override always takes precedence
    const globalModel = cfg.inspect<string>("ai.model");
    const explicitGlobal =
      globalModel?.globalValue?.trim() ||
      globalModel?.workspaceValue?.trim() ||
      globalModel?.workspaceFolderValue?.trim();
    if (explicitGlobal) return explicitGlobal;

    // Provider-specific model (only if user explicitly configured it)
    const providerModel = cfg.inspect<string>("ai.openaiModel");
    const explicitProvider =
      providerModel?.globalValue?.trim() ||
      providerModel?.workspaceValue?.trim() ||
      providerModel?.workspaceFolderValue?.trim();
    if (explicitProvider) return explicitProvider;

    // No explicit model set — let Codex use its default
    return undefined;
  }

  private isLikelyChatModel(modelId: string): boolean {
    const id = modelId.toLowerCase();
    if (
      id.startsWith("whisper") ||
      id.startsWith("tts-") ||
      id.startsWith("text-embedding") ||
      id.startsWith("omni-moderation") ||
      id.startsWith("dall-e") ||
      id.includes("search-") ||
      id.includes("transcribe")
    ) {
      return false;
    }

    return (
      id.startsWith("gpt-") ||
      /^o\d($|[-])/i.test(modelId) ||
      id.startsWith("chatgpt") ||
      id.includes("codex")
    );
  }

  private getFallbackModels(): AIModelInfo[] {
    return this.uniqueModels(
      [
        "gpt-5.2",
        DEFAULT_OPENAI_MODEL,
        "gpt-4.1",
        "gpt-5.3-codex",
        "gpt-5.2-codex",
        DEFAULT_CODEX_MODEL,
      ].map((id) => ({ id }))
    );
  }

  private uniqueModels(models: AIModelInfo[]): AIModelInfo[] {
    const seen = new Set<string>();
    const result: AIModelInfo[] = [];
    for (const model of models) {
      const key = model.id.trim();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ ...model, id: key });
    }
    return result;
  }

}
