import * as vscode from "vscode";
import { execFile } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { AIProvider, AIOptions, AIModelInfo } from "../types";
import { DEFAULT_CLAUDE_MODEL } from "../../constants";
import { AuthManager } from "../../auth/authManager";
import { config } from "../../config";
import {
  buildCommitSystemPrompt,
  normalizeCommitMessage,
  truncateDiffForAI,
} from "../prompt";

export class ClaudeProvider implements AIProvider {
  id = "claude";
  name = "Anthropic Claude";
  private authManager: AuthManager;
  private outputChannel: vscode.OutputChannel;

  constructor(authManager: AuthManager, outputChannel: vscode.OutputChannel) {
    this.authManager = authManager;
    this.outputChannel = outputChannel;
  }

  async isAvailable(): Promise<boolean> {
    // Stored API key always works
    const apiKey = await this.authManager.getAnthropicApiKey();
    if (apiKey) return true;

    // Check ANTHROPIC_API_KEY env var
    if (process.env.ANTHROPIC_API_KEY?.trim()) return true;

    // For login method, check if Claude Code CLI is available
    if (config.getAuthMethodForProvider("claude") === "login") {
      return this.authManager.hasClaudeCodeAuth();
    }

    return false;
  }

  async generateCommitMessage(diff: string, options: AIOptions): Promise<string> {
    // Prefer direct API key when available (more reliable than CLI)
    const apiKey = await this.resolveApiKey();
    if (apiKey) {
      return this.generateWithApiKey(diff, options, apiKey);
    }

    // Fall back to Claude Code CLI for login method
    if (config.getAuthMethodForProvider("claude") === "login") {
      return this.generateWithClaudeCode(diff, options);
    }

    throw new Error(
      "Anthropic API key not configured. Use 'GitDoc AI: Set Anthropic API Key' or set the ANTHROPIC_API_KEY environment variable."
    );
  }

  private async resolveApiKey(): Promise<string | undefined> {
    // 1) Stored API key in VS Code SecretStorage
    const stored = await this.authManager.getAnthropicApiKey();
    if (stored) return stored;

    // 2) ANTHROPIC_API_KEY environment variable
    const envKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (envKey) return envKey;

    return undefined;
  }

  async listModels(): Promise<AIModelInfo[]> {
    const fallback = this.getFallbackModels();
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      return fallback;
    }

    try {
      const client = new Anthropic({ apiKey });
      const response = await client.models.list();
      const models = response.data.map((model) => ({
        id: model.id,
        displayName: model.display_name,
        createdAtMs: Date.parse(model.created_at),
      }))
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

      return this.uniqueModels(models.length > 0 ? models : fallback);
    } catch {
      return fallback;
    }
  }

  private async generateWithApiKey(
    diff: string,
    options: AIOptions,
    resolvedKey?: string
  ): Promise<string> {
    const apiKey = resolvedKey || (await this.authManager.getAnthropicApiKey());
    if (!apiKey) {
      throw new Error("Anthropic API key not configured. Use 'GitDoc AI: Set Anthropic API Key' or set the ANTHROPIC_API_KEY environment variable.");
    }

    const client = new Anthropic({
      apiKey,
      timeout: Math.max(5000, config.aiRequestTimeoutMs),
    });
    const model = options.model || DEFAULT_CLAUDE_MODEL;
    const truncatedDiff = truncateDiffForAI(diff, options);
    const systemPrompt = buildCommitSystemPrompt(options);

    const response = await client.messages.create({
      model,
      max_tokens: 200,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Generate a commit message for the following git diff:\n\n${truncatedDiff}`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude");
    }

    return normalizeCommitMessage(textBlock.text);
  }

  private async generateWithClaudeCode(
    diff: string,
    options: AIOptions
  ): Promise<string> {
    const truncatedDiff = truncateDiffForAI(diff, options);
    const systemPrompt = buildCommitSystemPrompt(options);

    const prompt = `${systemPrompt}

Generate a commit message for the following git diff:

${truncatedDiff}`;

    const args = ["-p", prompt, "--output-format", "text"];
    if (options.model && options.model.trim().length > 0) {
      args.push("--model", options.model.trim());
    }

    try {
      const cwd =
        vscode.window.activeTextEditor?.document.uri.fsPath
          ? vscode.workspace.getWorkspaceFolder(
              vscode.window.activeTextEditor.document.uri
            )?.uri.fsPath
          : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      const cliTimeout = Math.max(15000, Math.round(config.aiRequestTimeoutMs * 1.5));

      // Strip env vars set by the Claude Code VS Code extension that
      // cause the CLI to try SSE communication instead of running standalone
      const env = { ...process.env };
      delete env.CLAUDE_CODE_SSE_PORT;
      delete env.CLAUDE_CODE_ENTRY_POINT;

      const response = await new Promise<string>((resolve, reject) => {
        const child = execFile("claude", args, {
          cwd,
          maxBuffer: 10 * 1024 * 1024,
          timeout: cliTimeout,
          env,
        }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          const out = stdout.trim();
          if (!out) {
            reject(new Error(stderr?.toString().trim() || "No response from Claude Code"));
            return;
          }
          resolve(out);
        });
        // Close stdin so the CLI doesn't wait for piped input
        child.stdin?.end();
      });

      return normalizeCommitMessage(response);
    } catch (error: any) {
      const errorMessage = error?.stderr?.toString().trim() || error.message;
      throw new Error(
        `Claude account login failed via Claude Code CLI: ${errorMessage}. Ensure 'claude' is installed and '/login' is complete.`
      );
    }
  }

  private getFallbackModels(): AIModelInfo[] {
    return this.uniqueModels(
      [
        DEFAULT_CLAUDE_MODEL,
        "claude-sonnet-4-5-20250929",
        "claude-opus-4-6",
        "claude-haiku-4-5-20251001",
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
