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
  private loginShellPathResolved = false;
  private loginShellPath: string | undefined;
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
    this.log("Checking OpenAI login auth via Codex CLI...", "debug");
    const codexPath = await this.getCodexCliPath();
    if (!codexPath) {
      this.log("Codex CLI path could not be resolved; OpenAI login auth unavailable.", "debug");
      return false;
    }
    this.log(`Resolved Codex CLI path: ${codexPath}`, "debug");

    const secretToken = await this.getOpenAIOAuthToken();
    if (secretToken) {
      this.log("OpenAI OAuth token found in VS Code SecretStorage.", "debug");
      return true;
    }
    this.log("No OpenAI OAuth token found in VS Code SecretStorage.", "debug");

    const auth = await this.readCodexAuthCache();
    const hasCacheAuth = !!auth.accessToken || !!auth.apiKey;
    this.log(
      `Codex auth cache result: accessToken=${!!auth.accessToken}, apiKey=${!!auth.apiKey}`,
      "debug"
    );
    return hasCacheAuth;
  }

  async hasClaudeCodeAuth(): Promise<boolean> {
    this.log("Checking Claude login auth via Claude Code CLI...", "debug");
    // Check that the CLI is installed AND has evidence of a completed login.
    // We avoid making an actual API call (slow, wastes tokens).
    // Instead, check for ~/.claude/ session artifacts that only exist
    // after a successful /login (settings, statsig cache, session-env).
    if (!(await this.isClaudeInstalled())) {
      this.log("Claude CLI path could not be resolved; Claude login auth unavailable.", "debug");
      return false;
    }
    const hasSessionData = await this.hasClaudeSessionData();
    this.log(`Claude session data check result: ${hasSessionData}`, "debug");
    return hasSessionData;
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
        this.log(`Claude session indicator found: ${indicator}`, "debug");
        return true;
      } catch {
        this.log(`Claude session indicator missing: ${indicator}`, "debug");
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
    this.log("Starting OpenAI sign-in via Codex CLI.", "debug");
    const codexPath = await this.getCodexCliPath();
    if (!codexPath) {
      this.log("Codex CLI was not found before sign-in flow.", "debug");
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

    const imported = await this.importOpenAICredentialsFromCodexCache();
    if (imported) {
      this.log("OpenAI credentials imported from Codex cache without prompting login.", "debug");
      vscode.window.showInformationMessage(
        "OpenAI login detected from Codex. GitDoc AI is ready to use account-based authentication."
      );
      return true;
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
    this.log(`Launching terminal login command: ${this.quoteForShell(codexPath)} login`, "debug");
    terminal.sendText(`${this.quoteForShell(codexPath)} login`, true);

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
    this.log("Attempting to import OpenAI credentials from Codex auth cache.", "debug");
    const auth = await this.readCodexAuthCache();
    if (!auth.apiKey && !auth.accessToken) {
      this.log("No OpenAI credentials found in Codex auth cache.", "debug");
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
    return !!(await this.getCodexCliPath());
  }

  async getCodexCliPath(): Promise<string | undefined> {
    return this.findCliPath("codex");
  }

  async getClaudeCliPath(): Promise<string | undefined> {
    return this.findCliPath("claude");
  }

  async getCliExecutionEnv(): Promise<NodeJS.ProcessEnv> {
    const loginShellPath = await this.getLoginShellPath();
    const knownDirs = this.getKnownCliDirs().join(path.delimiter);
    const mergedPath = this.mergePathValues(
      process.env.PATH,
      loginShellPath,
      knownDirs
    );
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (mergedPath) {
      env.PATH = mergedPath;
    }

    this.log(`CLI env PATH source (process.env.PATH): ${process.env.PATH || "(empty)"}`, "debug");
    this.log(`CLI env PATH source (login shell): ${loginShellPath || "(empty)"}`, "debug");
    this.log(`CLI env PATH source (known dirs): ${knownDirs || "(empty)"}`, "debug");
    this.log(`CLI env PATH merged: ${mergedPath || "(empty)"}`, "debug");

    return env;
  }

  private async findCliPath(command: "codex" | "claude"): Promise<string | undefined> {
    // Get merged env with login shell PATH for detection
    const env = await this.getCliExecutionEnv();

    // Strategy 1: Try the command directly (simplest, works for most users)
    this.log(`CLI check: trying '${command}' directly`, "debug");
    try {
      await execFileAsync(command, ["--version"], {
        timeout: AUTH_CLI_TIMEOUT_MS,
        env,
      });
      this.log(`CLI found: '${command}' works directly`, "debug");
      return command;
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        // Command exists but --version failed (maybe old version without --version)
        // Still usable
        this.log(`CLI found: '${command}' exists (non-ENOENT error)`, "debug");
        return command;
      }
      this.log(`CLI not in PATH: ${command} (ENOENT)`, "debug");
    }

    // Strategy 2: Try 'which' command (common on macOS/Linux)
    const fromWhich = await this.findCommandViaWhich(command, env);
    if (fromWhich) {
      this.log(`CLI found via which: ${fromWhich}`, "debug");
      return fromWhich;
    }

    // Strategy 3: Scan common installation directories
    const fromKnownDirs = await this.findInKnownDirs(command);
    if (fromKnownDirs) {
      this.log(`CLI found in known dir: ${fromKnownDirs}`, "debug");
      return fromKnownDirs;
    }

    this.log(`CLI not found: '${command}'`, "debug");
    return undefined;
  }

  private async findCommandViaWhich(
    command: "codex" | "claude",
    env: NodeJS.ProcessEnv
  ): Promise<string | undefined> {
    if (process.platform === "win32") {
      this.log(`Skipping 'which' on Windows`, "debug");
      return undefined;
    }

    this.log(`Trying 'which ${command}'`, "debug");
    try {
      const { stdout } = await execFileAsync("which", [command], {
        timeout: AUTH_CLI_TIMEOUT_MS,
        env,
      });
      const path = stdout.trim();
      this.log(`'which ${command}' returned: ${path || "(empty)"}`, "debug");
      if (path && path.length > 0) {
        return path;
      }
    } catch (error: any) {
      this.log(`'which ${command}' failed: ${error?.code || error?.message || "unknown"}`, "debug");
    }
    return undefined;
  }

  private async findInKnownDirs(
    command: "codex" | "claude"
  ): Promise<string | undefined> {
    const candidates = this.getCommandCandidates(command);
    const knownDirs = this.getKnownCliDirs();

    // Add nvm version directories dynamically
    const nvmDirs = await this.getNvmNodeBinDirs();
    const allDirs = [...knownDirs, ...nvmDirs];

    this.log(`Scanning ${allDirs.length} known directories for '${command}'`, "debug");

    for (const dir of allDirs) {
      for (const candidate of candidates) {
        const fullPath = path.join(dir, candidate);
        try {
          await fs.access(fullPath);
          this.log(`Found '${command}' at: ${fullPath}`, "debug");
          return fullPath;
        } catch {
          // Not found, try next
        }
      }
    }

    this.log(`'${command}' not found in any known directory`, "debug");
    return undefined;
  }

  private async getNvmNodeBinDirs(): Promise<string[]> {
    const dirs: string[] = [];
    const home = os.homedir();
    const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm");
    const versionsDir = path.join(nvmDir, "versions", "node");

    try {
      const versions = await fs.readdir(versionsDir);
      for (const version of versions) {
        dirs.push(path.join(versionsDir, version, "bin"));
      }
      this.log(`Found ${dirs.length} nvm node versions`, "debug");
    } catch {
      // nvm not present or no versions installed
    }

    return dirs;
  }

  private async getLoginShellPath(): Promise<string | undefined> {
    if (this.loginShellPathResolved) {
      return this.loginShellPath;
    }
    this.loginShellPathResolved = true;

    if (process.platform === "win32") {
      return undefined;
    }

    const shells = Array.from(
      new Set(
        [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        )
      )
    );

    for (const shellPath of shells) {
      this.log(`CLI PATH probe command: ${shellPath} -lc "printf %s \\\"$PATH\\\""`,"debug");
      try {
        const { stdout } = await execFileAsync(shellPath, ["-lc", "printf %s \"$PATH\""], {
          timeout: AUTH_CLI_TIMEOUT_MS,
        });
        const resolvedPath = stdout.trim();
        this.log(
          `CLI PATH probe result (${shellPath}): ${resolvedPath || "(empty)"}`,
          "debug"
        );
        if (resolvedPath.length > 0) {
          this.loginShellPath = resolvedPath;
          return this.loginShellPath;
        }
      } catch (error: any) {
        this.log(
          `CLI PATH probe failed (${shellPath}): ${this.formatExecError(error)}`,
          "debug"
        );
      }
    }

    return undefined;
  }

  private getKnownCliDirs(): string[] {
    const home = os.homedir();
    const dirs = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      path.join(home, "homebrew", "bin"),
      path.join(home, ".local", "bin"),
      path.join(home, ".npm-global", "bin"),
      path.join(home, ".npm", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, "bin"),
    ];

    // Add npm global prefix if configured
    const npmPrefix = process.env.npm_config_prefix;
    if (npmPrefix) {
      dirs.push(path.join(npmPrefix, "bin"));
    }

    // Add nvm (Node Version Manager) paths
    const nvmBin = process.env.NVM_BIN;
    if (nvmBin) {
      dirs.push(nvmBin);
    }

    // Also check default nvm location even if NVM_BIN isn't set
    const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm");
    try {
      const versionsDir = path.join(nvmDir, "versions", "node");
      // We can't synchronously read directory here, but add common paths
      // The actual scanning will happen in findInKnownDirs
      dirs.push(path.join(nvmDir, "current", "bin"));
    } catch {
      // Ignore if nvm not present
    }

    return dirs;
  }

  private splitPath(pathValue: string | undefined): string[] {
    if (!pathValue) {
      return [];
    }
    const entries = pathValue
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return Array.from(new Set(entries));
  }

  private mergePathValues(...values: Array<string | undefined>): string {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const value of values) {
      for (const entry of this.splitPath(value)) {
        if (seen.has(entry)) {
          continue;
        }
        seen.add(entry);
        merged.push(entry);
      }
    }

    return merged.join(path.delimiter);
  }

  private getCommandCandidates(command: "codex" | "claude"): string[] {
    if (process.platform !== "win32") {
      return [command];
    }

    return [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command];
  }

  private quoteForShell(value: string): string {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
      return value;
    }
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private async isClaudeInstalled(): Promise<boolean> {
    return !!(await this.getClaudeCliPath());
  }

  private getCodexAuthPath(): string {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    return path.join(codexHome, "auth.json");
  }

  private async readCodexAuthCache(): Promise<{
    apiKey?: string;
    accessToken?: string;
  }> {
    const authPath = this.getCodexAuthPath();
    this.log(`Reading Codex auth cache: ${authPath}`, "debug");
    try {
      const raw = await fs.readFile(authPath, "utf8");
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
    } catch (error: any) {
      this.log(
        `Failed reading Codex auth cache at ${authPath}: ${this.formatExecError(error)}`,
        "debug"
      );
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

  private toSingleLine(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/\s+/g, " ").trim();
  }

  private formatExecError(error: any): string {
    const code = error?.code ? `code=${String(error.code)}` : "code=(none)";
    const message = error?.message ? `message=${String(error.message)}` : `message=${String(error)}`;
    const stdout = this.toSingleLine(
      typeof error?.stdout === "string" ? error.stdout : error?.stdout?.toString?.()
    );
    const stderr = this.toSingleLine(
      typeof error?.stderr === "string" ? error.stderr : error?.stderr?.toString?.()
    );
    return `${code}; ${message}; stdout=${stdout || "(empty)"}; stderr=${stderr || "(empty)"}`;
  }

  private log(message: string, level: "error" | "info" | "debug" = "info"): void {
    if (!this.shouldLog(level)) {
      return;
    }
    this.outputChannel.appendLine(`[Auth] [${level.toUpperCase()}] ${message}`);
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
