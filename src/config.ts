import * as vscode from "vscode";
import { EXTENSION_ID } from "./constants";

export type AutoPushMode = "onCommit" | "afterDelay" | "off";
export type AutoPullMode = "onPush" | "afterDelay" | "off";
export type CommitValidationLevel = "error" | "warning" | "none";
export type PushMode = "forcePush" | "forcePushWithLease" | "push";
export type AIProvider = "claude" | "openai" | "copilot";
export type AuthMethod = "apiKey" | "login";
export type ProviderAuthMethod = AuthMethod | "inherit";
export type LogLevel = "error" | "info" | "debug";

function getConfig() {
  return vscode.workspace.getConfiguration(EXTENSION_ID);
}

export const config = {
  get enabled(): boolean {
    return getConfig().get<boolean>("enabled", false);
  },

  get autoCommitDelay(): number {
    return getConfig().get<number>("autoCommitDelay", 30000);
  },

  get autoPush(): AutoPushMode {
    return getConfig().get<AutoPushMode>("autoPush", "onCommit");
  },

  get autoPushDelay(): number {
    return getConfig().get<number>("autoPushDelay", 30000);
  },

  get autoPull(): AutoPullMode {
    return getConfig().get<AutoPullMode>("autoPull", "onPush");
  },

  get autoPullDelay(): number {
    return getConfig().get<number>("autoPullDelay", 30000);
  },

  get commitMessageFormat(): string {
    return getConfig().get<string>("commitMessageFormat", "ff");
  },

  get timeZone(): string {
    return getConfig().get<string>("timeZone", "");
  },

  get commitValidationLevel(): CommitValidationLevel {
    return getConfig().get<CommitValidationLevel>(
      "commitValidationLevel",
      "error"
    );
  },

  get commitOnClose(): boolean {
    return getConfig().get<boolean>("commitOnClose", true);
  },

  get filePattern(): string {
    return getConfig().get<string>("filePattern", "**/*");
  },

  get excludeBranches(): string[] {
    return getConfig().get<string[]>("excludeBranches", []);
  },

  get pushMode(): PushMode {
    return getConfig().get<PushMode>("pushMode", "forcePush");
  },

  get pullOnOpen(): boolean {
    return getConfig().get<boolean>("pullOnOpen", true);
  },

  get noVerify(): boolean {
    return getConfig().get<boolean>("noVerify", false);
  },

  get aiEnabled(): boolean {
    return getConfig().get<boolean>("ai.enabled", true);
  },

  get aiProvider(): AIProvider {
    return getConfig().get<AIProvider>("ai.provider", "claude");
  },

  isProviderEnabled(provider: AIProvider): boolean {
    return getConfig().get<boolean>(`providers.${provider}.enabled`, true);
  },

  get aiModel(): string {
    return getConfig().get<string>("ai.model", "");
  },

  get aiClaudeModel(): string {
    return getConfig().get<string>("ai.claudeModel", "");
  },

  get aiOpenAIModel(): string {
    return getConfig().get<string>("ai.openaiModel", "");
  },

  get aiCopilotModel(): string {
    return getConfig().get<string>("ai.copilotModel", "");
  },

  get aiCustomInstructions(): string {
    return getConfig().get<string>("ai.customInstructions", "");
  },

  get aiUseEmojis(): boolean {
    return getConfig().get<boolean>("ai.useEmojis", false);
  },

  get aiMaxDiffChars(): number {
    return getConfig().get<number>("ai.maxDiffChars", 200000);
  },

  get aiRequestTimeoutMs(): number {
    return getConfig().get<number>("ai.requestTimeoutMs", 60000);
  },

  get authMethod(): AuthMethod {
    return getConfig().get<AuthMethod>("auth.method", "apiKey");
  },

  getAuthMethodForProvider(provider: "claude" | "openai"): AuthMethod {
    const providerMethod = getConfig().get<ProviderAuthMethod>(
      `auth.${provider}.method`,
      "inherit"
    );
    if (providerMethod && providerMethod !== "inherit") {
      return providerMethod;
    }
    return this.authMethod;
  },

  get logLevel(): LogLevel {
    return getConfig().get<LogLevel>("output.logLevel", "debug");
  },

  get showOutputOnError(): boolean {
    return getConfig().get<boolean>("output.showOnError", true);
  },
};
