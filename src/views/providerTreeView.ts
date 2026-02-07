import * as vscode from "vscode";
import { config } from "../config";
import { AIManager } from "../ai/aiManager";
import { AuthManager } from "../auth/authManager";
import { EXTENSION_ID } from "../constants";

type ProviderItemType = "provider" | "detail";

export class ProviderTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly providerId: string,
    public readonly itemType: ProviderItemType,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly detailKey?: string
  ) {
    super(label, collapsible);
    this.contextValue = itemType === "provider" ? `provider.${providerId}` : "detail";
  }
}

export class ProviderTreeDataProvider
  implements vscode.TreeDataProvider<ProviderTreeItem>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<ProviderTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private disposables: vscode.Disposable[] = [];

  private providerStatus: Map<string, boolean> = new Map();

  constructor(
    private aiManager: AIManager,
    private authManager: AuthManager
  ) {
    // Refresh when auth changes
    this.disposables.push(
      authManager.onAuthChange(() => this.refresh())
    );
    // Refresh when settings change
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(EXTENSION_ID)) {
          this.refresh();
        }
      })
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ProviderTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ProviderTreeItem): Promise<ProviderTreeItem[]> {
    if (!element) {
      return this.getProviderItems();
    }
    return this.getProviderDetails(element.providerId);
  }

  private async getProviderItems(): Promise<ProviderTreeItem[]> {
    const providers = [
      { id: "claude", name: "Anthropic Claude" },
      { id: "openai", name: "OpenAI" },
      { id: "copilot", name: "GitHub Copilot" },
    ];

    const items: ProviderTreeItem[] = [];

    for (const provider of providers) {
      const enabled = config.isProviderEnabled(provider.id as any);
      const isActive = config.aiProvider === provider.id;
      const available = enabled ? await this.aiManager.isProviderAvailable(provider.id) : false;
      this.providerStatus.set(provider.id, available);

      const statusIcon = !enabled
        ? "$(circle-slash)"
        : available
          ? "$(check)"
          : "$(circle-large-outline)";
      const activeMarker = isActive ? " $(arrow-right)" : "";
      const label = `${statusIcon} ${provider.name}${activeMarker}`;

      const item = new ProviderTreeItem(
        label,
        provider.id,
        "provider",
        enabled
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );

      if (!enabled) {
        item.description = "Disabled";
        item.tooltip = `${provider.name} is disabled in settings. Enable it to use.`;
      } else if (available) {
        item.description = isActive ? "Active" : "Ready";
        item.tooltip = `${provider.name} is ${isActive ? "the active provider" : "available"}. ${isActive ? "" : "Run 'GitDoc AI: Select Provider' to switch."}`;
      } else {
        item.description = "Not signed in";
        item.tooltip = `${provider.name} needs authentication. Click to sign in.`;
      }

      // Clicking a provider that's not signed in triggers sign-in
      if (enabled && !available && provider.id !== "copilot") {
        item.command = {
          command: `${EXTENSION_ID}.treeSignIn`,
          title: "Sign In",
          arguments: [provider.id],
        };
      } else if (enabled) {
        item.command = {
          command: `${EXTENSION_ID}.selectProvider`,
          title: "Select Provider",
        };
      }

      items.push(item);
    }

    return items;
  }

  private async getProviderDetails(providerId: string): Promise<ProviderTreeItem[]> {
    const details: ProviderTreeItem[] = [];
    const enabled = config.isProviderEnabled(providerId as any);
    const available = this.providerStatus.get(providerId) ?? false;

    // Status
    const statusLabel = !enabled
      ? "Disabled in settings"
      : available
        ? "Signed In"
        : "Not signed in";
    const statusItem = new ProviderTreeItem(
      `Status: ${statusLabel}`,
      providerId,
      "detail",
      vscode.TreeItemCollapsibleState.None,
      "status"
    );
    statusItem.iconPath = new vscode.ThemeIcon(
      !enabled ? "circle-slash" : available ? "pass-filled" : "error"
    );
    details.push(statusItem);

    // Auth method
    if (providerId !== "copilot") {
      const method = config.getAuthMethodForProvider(providerId as "claude" | "openai");
      const methodLabel =
        method === "login"
          ? providerId === "claude"
            ? "Login (Claude Code CLI)"
            : "Login (Codex CLI)"
          : "API Key";
      const methodItem = new ProviderTreeItem(
        `Auth: ${methodLabel}`,
        providerId,
        "detail",
        vscode.TreeItemCollapsibleState.None,
        "method"
      );
      methodItem.iconPath = new vscode.ThemeIcon(method === "login" ? "terminal" : "key");
      details.push(methodItem);
    }

    // Model
    const model = this.getModelForProvider(providerId);
    const modelItem = new ProviderTreeItem(
      `Model: ${model || "(default)"}`,
      providerId,
      "detail",
      vscode.TreeItemCollapsibleState.None,
      "model"
    );
    modelItem.iconPath = new vscode.ThemeIcon("symbol-misc");
    modelItem.command = {
      command: `${EXTENSION_ID}.selectModel`,
      title: "Select Model",
    };
    modelItem.tooltip = "Click to change model";
    details.push(modelItem);

    // Sign In / Sign Out action
    if (enabled && providerId !== "copilot") {
      if (available) {
        const signOutItem = new ProviderTreeItem(
          "Sign Out",
          providerId,
          "detail",
          vscode.TreeItemCollapsibleState.None,
          "signout"
        );
        signOutItem.iconPath = new vscode.ThemeIcon("sign-out");
        signOutItem.command = {
          command: `${EXTENSION_ID}.signOut`,
          title: "Sign Out",
        };
        details.push(signOutItem);
      } else {
        const signInItem = new ProviderTreeItem(
          "Sign In",
          providerId,
          "detail",
          vscode.TreeItemCollapsibleState.None,
          "signin"
        );
        signInItem.iconPath = new vscode.ThemeIcon("sign-in");
        signInItem.command = {
          command: `${EXTENSION_ID}.treeSignIn`,
          title: "Sign In",
          arguments: [providerId],
        };
        details.push(signInItem);

        const apiKeyItem = new ProviderTreeItem(
          "Set API Key",
          providerId,
          "detail",
          vscode.TreeItemCollapsibleState.None,
          "apikey"
        );
        apiKeyItem.iconPath = new vscode.ThemeIcon("key");
        apiKeyItem.command = {
          command: `${EXTENSION_ID}.treeSetApiKey`,
          title: "Set API Key",
          arguments: [providerId],
        };
        details.push(apiKeyItem);
      }
    }

    return details;
  }

  private getModelForProvider(providerId: string): string {
    // Check global override first
    const globalModel = config.aiModel.trim();
    if (globalModel) return globalModel;

    switch (providerId) {
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

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this._onDidChangeTreeData.dispose();
  }
}
