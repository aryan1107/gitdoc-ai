import * as vscode from "vscode";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import {
  ANTHROPIC_API_KEY_SECRET,
  OPENAI_API_KEY_SECRET,
  ANTHROPIC_OAUTH_TOKEN_SECRET,
  OPENAI_OAUTH_TOKEN_SECRET,
  EXTENSION_ID,
} from "../constants";
import { config } from "../config";

const execFileAsync = promisify(execFile);
const AUTH_CLI_TIMEOUT_MS = 7000;

export class AuthManager implements vscode.Disposable {
  private secretStorage: vscode.SecretStorage;
  private outputChannel: vscode.OutputChannel;
  private onAuthChangeEmitter = new vscode.EventEmitter<void>();
  private disposables: vscode.Disposable[] = [];
  public onAuthChange = this.onAuthChangeEmitter.event;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
  ) {
    this.secretStorage = context.secrets;
    this.outputChannel = outputChannel;

    // Listen for secret changes
    this.disposables.push(
      context.secrets.onDidChange(() => {
        this.onAuthChangeEmitter.fire();
      })
    );
  }

  // ─── Anthropic (Claude) ───

  async getAnthropicApiKey(): Promise<string | undefined> {
    return this.secretStorage.get(ANTHROPIC_API_KEY_SECRET);
  }

  async setAnthropicApiKey(apiKey: string): Promise<void> {
    await this.secretStorage.store(ANTHROPIC_API_KEY_SECRET, apiKey);
    this.log("Anthropic API key stored");
    this.onAuthChangeEmitter.fire();
  }

  async clearAnthropicApiKey(): Promise<void> {
    await this.secretStorage.delete(ANTHROPIC_API_KEY_SECRET);
    await this.secretStorage.delete(ANTHROPIC_OAUTH_TOKEN_SECRET);
    this.log("Anthropic credentials cleared");
    this.onAuthChangeEmitter.fire();
  }

  async signInAnthropic(forceApiKey = false): Promise<boolean> {
    if (!forceApiKey && config.getAuthMethodForProvider("claude") === "login") {
      return this.signInAnthropicViaClaudeCode();
    }

    const apiKey = await vscode.window.showInputBox({
      prompt: "Enter your Anthropic API key",
      placeHolder: "sk-ant-...",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "API key is required";
        }
        if (!value.startsWith("sk-ant-")) {
          return 'API key should start with "sk-ant-"';
        }
        return undefined;
      },
    });

    if (apiKey) {
      await this.setAnthropicApiKey(apiKey.trim());
      vscode.window.showInformationMessage("Anthropic API key saved successfully!");
      return true;
    }

    return false;
  }

  // ─── OpenAI ───

  async getOpenAIApiKey(): Promise<string | undefined> {
    return this.secretStorage.get(OPENAI_API_KEY_SECRET);
  }

  async getOpenAIOAuthToken(): Promise<string | undefined> {
    return this.secretStorage.get(OPENAI_OAUTH_TOKEN_SECRET);
  }

  async setOpenAIApiKey(apiKey: string): Promise<void> {
    await this.secretStorage.store(OPENAI_API_KEY_SECRET, apiKey);
    this.log("OpenAI API key stored");
    this.onAuthChangeEmitter.fire();
  }

  async clearOpenAIApiKey(): Promise<void> {
    await this.secretStorage.delete(OPENAI_API_KEY_SECRET);
    await this.secretStorage.delete(OPENAI_OAUTH_TOKEN_SECRET);
    this.log("OpenAI credentials cleared");
    this.onAuthChangeEmitter.fire();
  }

  async signInOpenAI(forceApiKey = false): Promise<boolean> {
    if (!forceApiKey && config.getAuthMethodForProvider("openai") === "login") {
      return this.signInOpenAIViaCodex();
    }

    const apiKey = await vscode.window.showInputBox({
      prompt: "Enter your OpenAI API key",
      placeHolder: "sk-...",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "API key is required";
        }
        return undefined;
      },
    });

    if (apiKey) {
      await this.setOpenAIApiKey(apiKey.trim());
      vscode.window.showInformationMessage("OpenAI API key saved successfully!");
      return true;
    }

    return false;
  }

  async hasOpenAICodexAuth(): Promise<boolean> {
    if (await this.getOpenAIOAuthToken()) {
      return true;
    }

    const auth = await this.readCodexAuthCache();
    return !!auth.accessToken || !!auth.apiKey;
  }

  async hasClaudeCodeAuth(): Promise<boolean> {
    // Check that the CLI is installed AND has evidence of a completed login.
    // We avoid making an actual API call (slow, wastes tokens).
    // Instead, check for ~/.claude/ session artifacts that only exist
    // after a successful /login (settings, statsig cache, session-env).
    if (!(await this.isClaudeInstalled())) {
      return false;
    }
    return this.hasClaudeSessionData();
  }

  private async hasClaudeSessionData(): Promise<boolean> {
    const claudeHome = process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
    // These directories/files are created after a successful login session
    const indicators = [
      path.join(claudeHome, "statsig"),         // Feature flags (requires auth)
      path.join(claudeHome, "settings.json"),    // User settings
      path.join(claudeHome, "projects"),         // Project data from active use
    ];
    for (const indicator of indicators) {
      try {
        await fs.access(indicator);
        return true;
      } catch {
        // Try next indicator
      }
    }
    return false;
  }

  // ─── Generic ───

  async signIn(): Promise<boolean> {
    const provider = config.aiProvider;

    switch (provider) {
      case "claude":
        return this.signInAnthropic();
      case "openai":
        return this.signInOpenAI();
      case "copilot":
        vscode.window.showInformationMessage(
          "Copilot authentication is managed through the GitHub Copilot extension. Please install and sign in to Copilot."
        );
        return false;
      default:
        return false;
    }
  }

  async signInApiKey(): Promise<boolean> {
    const provider = config.aiProvider;

    switch (provider) {
      case "claude":
        return this.signInAnthropic(true);
      case "openai":
        return this.signInOpenAI(true);
      case "copilot":
        vscode.window.showInformationMessage(
          "Copilot does not use API keys."
        );
        return false;
      default:
        return false;
    }
  }

  async signInForProvider(provider: "claude" | "openai"): Promise<boolean> {
    if (provider === "claude") {
      return this.signInAnthropic();
    }
    return this.signInOpenAI();
  }

  async signInApiKeyForProvider(
    provider: "claude" | "openai"
  ): Promise<boolean> {
    if (provider === "claude") {
      return this.signInAnthropic(true);
    }
    return this.signInOpenAI(true);
  }

  async signOut(): Promise<void> {
    const provider = config.aiProvider;

    switch (provider) {
      case "claude":
        await this.clearAnthropicApiKey();
        break;
      case "openai":
        await this.clearOpenAIApiKey();
        break;
      case "copilot":
        vscode.window.showInformationMessage(
          "Copilot authentication is managed through the GitHub Copilot extension."
        );
        return;
    }

    vscode.window.showInformationMessage(`Signed out from ${provider}`);
  }

  async isSignedIn(): Promise<boolean> {
    const provider = config.aiProvider;

    switch (provider) {
      case "claude":
        if (config.getAuthMethodForProvider("claude") === "login") {
          return this.hasClaudeCodeAuth();
        }
        return !!(await this.getAnthropicApiKey());
      case "openai":
        if (config.getAuthMethodForProvider("openai") === "login") {
          return this.hasOpenAICodexAuth();
        }
        return !!(await this.getOpenAIApiKey());
      case "copilot":
        try {
          const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
          return models.length > 0;
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  private async signInOpenAIViaCodex(): Promise<boolean> {
    const imported = await this.importOpenAICredentialsFromCodexCache();
    if (imported) {
      vscode.window.showInformationMessage(
        "OpenAI login detected from Codex. GitDoc AI is ready to use account-based authentication."
      );
      return true;
    }

    if (!(await this.isCodexInstalled())) {
      const choice = await vscode.window.showWarningMessage(
        "Codex CLI is not installed or not in PATH. Enter an OpenAI API key from platform.openai.com, or install Codex CLI and run 'codex login'.",
        "Enter API Key",
        "Cancel"
      );
      if (choice === "Enter API Key") {
        return this.signInOpenAI(true);
      }
      return false;
    }

    const terminal = vscode.window.createTerminal({
      name: "GitDoc AI OpenAI Sign-In",
    });
    this.watchTerminalForCompletion(
      terminal,
      async () => this.importOpenAICredentialsFromCodexCache(),
      "OpenAI login complete. GitDoc AI is now authenticated.",
      "OpenAI login was not detected. If login did not complete, run 'GitDoc AI: Sign In to AI Provider' again."
    );
    terminal.show();
    terminal.sendText("codex login", true);

    vscode.window.showInformationMessage(
      "Complete OpenAI login in the terminal/browser. GitDoc AI will auto-detect completion when the terminal closes."
    );
    return false;
  }

  private async signInAnthropicViaClaudeCode(): Promise<boolean> {
    // 1) Auto-detect ANTHROPIC_API_KEY environment variable
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey && envKey.trim().length > 0) {
      await this.setAnthropicApiKey(envKey.trim());
      vscode.window.showInformationMessage(
        "Anthropic API key imported from ANTHROPIC_API_KEY environment variable."
      );
      return true;
    }

    // 2) Check if Claude Code CLI is installed AND authenticated
    if (await this.isClaudeInstalled()) {
      if (await this.hasClaudeCodeAuth()) {
        vscode.window.showInformationMessage(
          "Claude Code CLI detected with valid authentication. AI commit messages are ready."
        );
        return true;
      }
      // CLI installed but not logged in
      const cliChoice = await vscode.window.showWarningMessage(
        "Claude Code CLI is installed but not authenticated. Run 'claude' in your terminal and complete '/login', or enter an API key instead.",
        "Enter API Key",
        "Cancel"
      );
      if (cliChoice === "Enter API Key") {
        return this.signInAnthropic(true);
      }
      return false;
    }

    // 3) Claude Code not installed — offer API key as fallback
    const choice = await vscode.window.showWarningMessage(
      "Claude Code CLI not found. Enter an Anthropic API key from console.anthropic.com to use Claude for commit messages.",
      "Enter API Key",
      "Cancel"
    );
    if (choice === "Enter API Key") {
      return this.signInAnthropic(true);
    }
    return false;
  }

  private async importOpenAICredentialsFromCodexCache(): Promise<boolean> {
    const auth = await this.readCodexAuthCache();
    if (!auth.apiKey && !auth.accessToken) {
      return false;
    }

    if (auth.apiKey) {
      await this.setOpenAIApiKey(auth.apiKey);
    }
    if (auth.accessToken) {
      await this.secretStorage.store(OPENAI_OAUTH_TOKEN_SECRET, auth.accessToken);
    }

    this.log("OpenAI credentials imported from Codex auth cache");
    this.onAuthChangeEmitter.fire();
    return true;
  }

  private async isCodexInstalled(): Promise<boolean> {
    try {
      await execFileAsync("codex", ["--version"], {
        timeout: AUTH_CLI_TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async isClaudeInstalled(): Promise<boolean> {
    try {
      await execFileAsync("claude", ["--version"], {
        timeout: AUTH_CLI_TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  }

  private getCodexAuthPath(): string {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    return path.join(codexHome, "auth.json");
  }

  private async readCodexAuthCache(): Promise<{
    apiKey?: string;
    accessToken?: string;
  }> {
    try {
      const raw = await fs.readFile(this.getCodexAuthPath(), "utf8");
      const json = JSON.parse(raw) as Record<string, unknown>;
      const apiKey =
        this.getStringAtPath(json, ["api_key"]) ||
        this.getStringAtPath(json, ["apiKey"]) ||
        this.getStringAtPath(json, ["OPENAI_API_KEY"]);

      const accessToken =
        this.getStringAtPath(json, ["access_token"]) ||
        this.getStringAtPath(json, ["accessToken"]) ||
        this.getStringAtPath(json, ["tokens", "access_token"]) ||
        this.getStringAtPath(json, ["tokens", "accessToken"]);

      return {
        apiKey,
        accessToken,
      };
    } catch {
      return {};
    }
  }

  private getStringAtPath(
    obj: Record<string, unknown>,
    pathParts: string[]
  ): string | undefined {
    let current: unknown = obj;
    for (const part of pathParts) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (typeof current === "string" && current.trim().length > 0) {
      return current.trim();
    }
    return undefined;
  }

  private watchTerminalForCompletion(
    terminal: vscode.Terminal,
    onCloseCheck: () => Promise<boolean>,
    successMessage: string,
    retryMessage: string
  ): void {
    const disposable = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
      if (closedTerminal !== terminal) {
        return;
      }

      disposable.dispose();
      this.disposables = this.disposables.filter((d) => d !== disposable);

      try {
        if (await onCloseCheck()) {
          await this.autoEnableAI();
          vscode.window.showInformationMessage(successMessage);
        } else {
          vscode.window.showWarningMessage(retryMessage);
        }
      } catch {
        vscode.window.showWarningMessage(retryMessage);
      }
    });

    this.disposables.push(disposable);
  }

  private async autoEnableAI(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
    if (!cfg.get<boolean>("ai.enabled")) {
      await cfg.update("ai.enabled", true, vscode.ConfigurationTarget.Global);
      this.log("AI auto-enabled after successful authentication");
    }
  }

  private log(message: string): void {
    if (!this.shouldLog("info")) {
      return;
    }
    this.outputChannel.appendLine(`[Auth] ${message}`);
  }

  private shouldLog(level: "error" | "info" | "debug"): boolean {
    const weights = { error: 0, info: 1, debug: 2 } as const;
    return weights[level] <= weights[config.logLevel];
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.onAuthChangeEmitter.dispose();
  }
}
