import * as vscode from "vscode";
import { AIProvider, config } from "./config";
import { EXTENSION_ID, OUTPUT_CHANNEL_NAME } from "./constants";
import { GitManager } from "./git/gitManager";
import { AIManager } from "./ai/aiManager";
import { AuthManager } from "./auth/authManager";
import { StatusBarManager } from "./statusBar";
import { ProviderTreeDataProvider } from "./views/providerTreeView";
import { ProviderWebviewPanel } from "./views/providerWebview";
import { isGitRepo } from "./git/gitUtils";
import { AIModelInfo } from "./ai/types";

let gitManager: GitManager | undefined;
let aiManager: AIManager | undefined;
let authManager: AuthManager | undefined;
let statusBar: StatusBarManager | undefined;
let providerTreeProvider: ProviderTreeDataProvider | undefined;
let providerWebview: ProviderWebviewPanel | undefined;
let outputChannel: vscode.OutputChannel;

type ModelQuickPickItem = vscode.QuickPickItem & {
  modelId?: string;
  isCustom?: boolean;
};

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(outputChannel);
  const extensionSettingsQuery = `@ext:${context.extension.id}`;

  const folders = vscode.workspace.workspaceFolders ?? [];
  const hasGitWorkspace = (
    await Promise.all(folders.map((folder) => isGitRepo(folder.uri.fsPath)))
  ).some(Boolean);
  if (!hasGitWorkspace) {
    outputChannel.appendLine("Not a git repository. GitDoc AI will not activate.");
    return;
  }

  // Initialize managers
  authManager = new AuthManager(context, outputChannel);
  aiManager = new AIManager(outputChannel, authManager);
  gitManager = new GitManager(outputChannel, aiManager);
  statusBar = new StatusBarManager();

  // Register provider TreeView in SCM sidebar
  providerTreeProvider = new ProviderTreeDataProvider(aiManager, authManager);
  const treeView = vscode.window.createTreeView("gitdocAI.providers", {
    treeDataProvider: providerTreeProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(authManager, aiManager, gitManager, statusBar, providerTreeProvider, treeView);

  // Listen for git status changes
  gitManager.onStatusChange((status) => {
    statusBar?.updateStatus(status);
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(`${EXTENSION_ID}.enable`, async () => {
      await vscode.workspace
        .getConfiguration(EXTENSION_ID)
        .update("enabled", true, vscode.ConfigurationTarget.Workspace);
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.disable`, async () => {
      await vscode.workspace
        .getConfiguration(EXTENSION_ID)
        .update("enabled", false, vscode.ConfigurationTarget.Workspace);
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.commit`, async () => {
      if (!gitManager) return;
      const success = await gitManager.commit();
      if (success) {
        vscode.window.showInformationMessage("GitDoc AI: Changes committed.");
      }
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.signIn`, async () => {
      if (!authManager) return;
      const success = await authManager.signIn();
      if (success) {
        await autoEnableAI();
      }
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.signInClaude`, async () => {
      if (!authManager) return;
      if (!config.isProviderEnabled("claude")) {
        vscode.window.showWarningMessage(
          "Anthropic Claude provider is disabled in settings."
        );
        return;
      }
      const success = await authManager.signInForProvider("claude");
      if (success) {
        await autoEnableAI("claude");
      }
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.signInOpenAI`, async () => {
      if (!authManager) return;
      if (!config.isProviderEnabled("openai")) {
        vscode.window.showWarningMessage(
          "OpenAI provider is disabled in settings."
        );
        return;
      }
      const success = await authManager.signInForProvider("openai");
      if (success) {
        await autoEnableAI("openai");
      }
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.signOut`, async () => {
      if (!authManager) return;
      await authManager.signOut();
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.selectProvider`, async () => {
      const providers = [
        config.isProviderEnabled("claude")
          ? {
              label: "Anthropic Claude",
              description: "claude-sonnet-4-5-20250929, claude-opus-4-6, claude-haiku-4-5-20251001",
              id: "claude",
            }
          : undefined,
        config.isProviderEnabled("openai")
          ? {
              label: "OpenAI",
              description: "gpt-4o, gpt-4o-mini, o1, o3-mini",
              id: "openai",
            }
          : undefined,
        config.isProviderEnabled("copilot")
          ? {
              label: "GitHub Copilot",
              description: "Requires Copilot extension",
              id: "copilot",
            }
          : undefined,
      ].filter((provider): provider is { label: string; description: string; id: string } => !!provider);

      if (providers.length === 0) {
        vscode.window.showWarningMessage(
          "No AI providers are enabled. Enable at least one provider in GitDoc AI settings."
        );
        return;
      }

      const selected = await vscode.window.showQuickPick(providers, {
        placeHolder: "Select an AI provider for commit messages",
      });

      if (selected) {
        await vscode.workspace
          .getConfiguration(EXTENSION_ID)
          .update("ai.provider", selected.id, vscode.ConfigurationTarget.Global);
        await vscode.workspace
          .getConfiguration(EXTENSION_ID)
          .update("ai.enabled", true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          `AI provider set to ${selected.label}`
        );
      }
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.selectModel`, async () => {
      if (!aiManager) return;

      const provider = config.aiProvider;
      if (!config.isProviderEnabled(provider)) {
        vscode.window.showWarningMessage(
          `${toProviderDisplayName(provider)} provider is disabled in settings.`
        );
        return;
      }

      let models: AIModelInfo[] = [];
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Fetching ${toProviderDisplayName(provider)} models...`,
          cancellable: false,
        },
        async () => {
          try {
            models = await aiManager!.listModels(provider);
          } catch (error: any) {
            outputChannel.appendLine(
              `[AI] Failed to list ${provider} models: ${error?.message || String(error)}`
            );
          }
        }
      );

      const currentModel = getProviderModelSetting(provider);
      const items: ModelQuickPickItem[] = models.map((model, index) => {
        const isCurrent = model.id === currentModel;
        return {
          label: `${isCurrent ? "$(check) " : ""}${model.id}`,
          detail: model.displayName,
          description: isCurrent
            ? "Current"
            : index === 0
              ? "Latest available"
              : undefined,
          modelId: model.id,
        };
      });
      items.push({
        label: "$(edit) Custom model...",
        description: "Type a model id manually",
        isCustom: true,
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select ${toProviderDisplayName(provider)} model (current: ${currentModel || "default"})`,
        title: "GitDoc AI: Select Model",
      });
      if (!selected) {
        return;
      }

      let nextModel = selected.modelId;
      if (selected.isCustom) {
        nextModel = await vscode.window.showInputBox({
          prompt: `Enter ${toProviderDisplayName(provider)} model id`,
          placeHolder: "e.g. gpt-4o or claude-sonnet-4-5-20250929",
          value: currentModel,
          ignoreFocusOut: true,
        });
      }

      const normalizedModel = nextModel?.trim();
      if (!normalizedModel) {
        return;
      }

      const extensionConfig = vscode.workspace.getConfiguration(EXTENSION_ID);
      await extensionConfig.update(
        getProviderModelSettingKey(provider),
        normalizedModel,
        vscode.ConfigurationTarget.Global
      );

      if (config.aiModel.trim().length > 0) {
        const action = await vscode.window.showWarningMessage(
          "Global model override is set and will take precedence over provider-specific model. Clear global override now?",
          "Clear Global Override",
          "Keep Override"
        );
        if (action === "Clear Global Override") {
          await extensionConfig.update(
            "ai.model",
            "",
            vscode.ConfigurationTarget.Global
          );
        }
      }

      vscode.window.showInformationMessage(
        `${toProviderDisplayName(provider)} model set to ${normalizedModel}`
      );
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.setApiKey`, async () => {
      if (!authManager) return;

      const provider = config.aiProvider;
      if (provider === "copilot") {
        vscode.window.showInformationMessage(
          "Copilot doesn't use an API key. Please sign in through the Copilot extension."
        );
        return;
      }

      const success = await authManager.signInApiKey();
      if (success) {
        await autoEnableAI();
      }
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.setClaudeApiKey`, async () => {
      if (!authManager) return;
      if (!config.isProviderEnabled("claude")) {
        vscode.window.showWarningMessage(
          "Anthropic Claude provider is disabled in settings."
        );
        return;
      }
      const success = await authManager.signInApiKeyForProvider("claude");
      if (success) {
        await autoEnableAI("claude");
      }
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.setOpenAIApiKey`, async () => {
      if (!authManager) return;
      if (!config.isProviderEnabled("openai")) {
        vscode.window.showWarningMessage(
          "OpenAI provider is disabled in settings."
        );
        return;
      }
      const success = await authManager.signInApiKeyForProvider("openai");
      if (success) {
        await autoEnableAI("openai");
      }
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.openSettings`, async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        extensionSettingsQuery
      );
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.showOutput`, async () => {
      outputChannel.show(true);
    }),

    vscode.commands.registerCommand(
      `${EXTENSION_ID}.squashAbove`,
      async (item: any) => {
        if (!gitManager || !item?.id) return;

        const message = await vscode.window.showInputBox({
          prompt: "Enter a message for the squashed commit",
          placeHolder: "Squashed commit message",
        });

        if (message) {
          await gitManager.squashAbove(item.id, message);
        }
      }
    ),

    vscode.commands.registerCommand(
      `${EXTENSION_ID}.undoVersion`,
      async (item: any) => {
        if (!gitManager || !item?.id) return;
        await gitManager.undoVersion(item.id);
      }
    ),

    vscode.commands.registerCommand(
      `${EXTENSION_ID}.restoreVersion`,
      async (item: any) => {
        if (!gitManager || !item?.id) return;
        const uri = item.uri;
        if (uri) {
          const relativePath = vscode.workspace.asRelativePath(uri);
          await gitManager.restoreVersion(item.id, relativePath);
        }
      }
    ),

    // Tree view commands
    vscode.commands.registerCommand(
      `${EXTENSION_ID}.treeSignIn`,
      async (providerId?: string) => {
        if (!authManager) return;
        const id = providerId || config.aiProvider;
        let success = false;
        if (id === "claude") {
          success = await authManager.signInForProvider("claude");
        } else if (id === "openai") {
          success = await authManager.signInForProvider("openai");
        }
        if (success) {
          await autoEnableAI(id as AIProvider);
        }
        providerTreeProvider?.refresh();
      }
    ),

    vscode.commands.registerCommand(
      `${EXTENSION_ID}.treeSetApiKey`,
      async (providerId?: string) => {
        if (!authManager) return;
        const id = providerId || config.aiProvider;
        let success = false;
        if (id === "claude") {
          success = await authManager.signInApiKeyForProvider("claude");
        } else if (id === "openai") {
          success = await authManager.signInApiKeyForProvider("openai");
        }
        if (success) {
          await autoEnableAI(id as AIProvider);
        }
        providerTreeProvider?.refresh();
      }
    ),

    vscode.commands.registerCommand(`${EXTENSION_ID}.refreshProviders`, () => {
      providerTreeProvider?.refresh();
    }),

    vscode.commands.registerCommand(`${EXTENSION_ID}.manageProviders`, async () => {
      if (!aiManager || !authManager) return;
      if (!providerWebview) {
        providerWebview = ProviderWebviewPanel.create(aiManager, authManager);
      }
      await providerWebview.show();
    })
  );

  // Set context for command visibility
  vscode.commands.executeCommand(
    "setContext",
    `${EXTENSION_ID}.enabled`,
    config.enabled
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration(`${EXTENSION_ID}.enabled`)) {
        const enabled = config.enabled;
        vscode.commands.executeCommand(
          "setContext",
          `${EXTENSION_ID}.enabled`,
          enabled
        );

        if (enabled) {
          await gitManager?.enable();
          statusBar?.show();
          outputChannel.appendLine("GitDoc AI enabled via settings");
        } else {
          gitManager?.disable();
          statusBar?.updateStatus("disabled");
          outputChannel.appendLine("GitDoc AI disabled via settings");
        }
        return;
      }

      if (
        config.enabled &&
        (e.affectsConfiguration(`${EXTENSION_ID}.autoPush`) ||
          e.affectsConfiguration(`${EXTENSION_ID}.autoPushDelay`) ||
          e.affectsConfiguration(`${EXTENSION_ID}.autoPull`) ||
          e.affectsConfiguration(`${EXTENSION_ID}.autoPullDelay`))
      ) {
        await gitManager?.refreshConfiguration();
        outputChannel.appendLine("GitDoc AI sync timers updated from settings");
      }
    })
  );

  // Auto-enable if already enabled in settings
  if (config.enabled) {
    await gitManager.enable();
    statusBar.show();
  }

  outputChannel.appendLine("GitDoc AI extension activated");
}

async function autoEnableAI(provider?: AIProvider): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
  if (!cfg.get<boolean>("ai.enabled")) {
    await cfg.update("ai.enabled", true, vscode.ConfigurationTarget.Global);
  }
  if (provider) {
    await cfg.update("ai.provider", provider, vscode.ConfigurationTarget.Global);
  }
}

export async function deactivate(): Promise<void> {
  if (config.enabled) {
    try {
      await gitManager?.commitOnClose();
    } catch {
      // Best effort.
    }
  }
  outputChannel?.appendLine("GitDoc AI extension deactivated");
}

function toProviderDisplayName(provider: AIProvider): string {
  switch (provider) {
    case "claude":
      return "Anthropic Claude";
    case "openai":
      return "OpenAI";
    case "copilot":
      return "GitHub Copilot";
    default:
      return provider;
  }
}

function getProviderModelSetting(provider: AIProvider): string {
  switch (provider) {
    case "claude":
      return config.aiClaudeModel;
    case "openai":
      return config.aiOpenAIModel;
    case "copilot":
      return config.aiCopilotModel;
    default:
      return "";
  }
}

function getProviderModelSettingKey(provider: AIProvider): string {
  switch (provider) {
    case "claude":
      return "ai.claudeModel";
    case "openai":
      return "ai.openaiModel";
    case "copilot":
      return "ai.copilotModel";
    default:
      return "ai.model";
  }
}
