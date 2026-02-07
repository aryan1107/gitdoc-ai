import * as vscode from "vscode";
import { config, AIProvider } from "../config";
import { AIManager } from "../ai/aiManager";
import { AuthManager } from "../auth/authManager";
import { EXTENSION_ID } from "../constants";

interface ProviderRow {
  id: string;
  name: string;
  enabled: boolean;
  isActive: boolean;
  authenticated: boolean;
  authMethod: string;
  model: string;
}

export class ProviderWebviewPanel implements vscode.Disposable {
  private static instance: ProviderWebviewPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private aiManager: AIManager,
    private authManager: AuthManager
  ) {}

  static create(
    aiManager: AIManager,
    authManager: AuthManager
  ): ProviderWebviewPanel {
    if (!ProviderWebviewPanel.instance) {
      ProviderWebviewPanel.instance = new ProviderWebviewPanel(
        aiManager,
        authManager
      );
    }
    return ProviderWebviewPanel.instance;
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      await this.updateContent();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "gitdocAI.manageProviders",
      "GitDoc AI — Providers",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );

    await this.updateContent();
  }

  async updateContent(): Promise<void> {
    if (!this.panel) return;
    const rows = await this.getProviderRows();
    this.panel.webview.html = this.buildHtml(rows);
  }

  private async getProviderRows(): Promise<ProviderRow[]> {
    const providers: { id: string; name: string }[] = [
      { id: "claude", name: "Anthropic Claude" },
      { id: "openai", name: "OpenAI" },
      { id: "copilot", name: "GitHub Copilot" },
    ];

    const rows: ProviderRow[] = [];
    for (const p of providers) {
      const enabled = config.isProviderEnabled(p.id as AIProvider);
      const isActive = config.aiProvider === p.id;
      const authenticated = enabled
        ? await this.aiManager.isProviderAvailable(p.id)
        : false;

      let authMethod = "—";
      if (p.id === "copilot") {
        authMethod = "Copilot Extension";
      } else {
        const method = config.getAuthMethodForProvider(
          p.id as "claude" | "openai"
        );
        authMethod =
          method === "login"
            ? p.id === "claude"
              ? "Claude Code CLI"
              : "Codex CLI"
            : "API Key";
      }

      let model = config.aiModel.trim();
      if (!model) {
        switch (p.id) {
          case "claude":
            model = config.aiClaudeModel || "default";
            break;
          case "openai":
            model = config.aiOpenAIModel || "default";
            break;
          case "copilot":
            model = config.aiCopilotModel || "default";
            break;
        }
      }

      rows.push({
        id: p.id,
        name: p.name,
        enabled,
        isActive,
        authenticated,
        authMethod,
        model,
      });
    }
    return rows;
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.command) {
      case "signIn": {
        const id = msg.providerId as "claude" | "openai";
        if (id === "claude") {
          await this.authManager.signInForProvider("claude");
        } else if (id === "openai") {
          await this.authManager.signInForProvider("openai");
        }
        await this.updateContent();
        break;
      }
      case "setApiKey": {
        const id = msg.providerId as "claude" | "openai";
        if (id === "claude") {
          await this.authManager.signInApiKeyForProvider("claude");
        } else if (id === "openai") {
          await this.authManager.signInApiKeyForProvider("openai");
        }
        await this.updateContent();
        break;
      }
      case "signOut": {
        await this.authManager.signOut();
        await this.updateContent();
        break;
      }
      case "toggleEnabled": {
        const id = msg.providerId;
        const current = config.isProviderEnabled(id as AIProvider);
        await vscode.workspace
          .getConfiguration(EXTENSION_ID)
          .update(
            `providers.${id}.enabled`,
            !current,
            vscode.ConfigurationTarget.Global
          );
        await this.updateContent();
        break;
      }
      case "setActive": {
        const id = msg.providerId;
        await vscode.workspace
          .getConfiguration(EXTENSION_ID)
          .update("ai.provider", id, vscode.ConfigurationTarget.Global);
        await this.updateContent();
        break;
      }
      case "selectModel": {
        await vscode.commands.executeCommand(`${EXTENSION_ID}.selectModel`);
        await this.updateContent();
        break;
      }
      case "openSettings": {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          `@ext:gitdoc-ai.gitdoc-ai`
        );
        break;
      }
    }
  }

  private buildHtml(rows: ProviderRow[]): string {
    const tableRows = rows
      .map((r) => {
        const statusBadge = !r.enabled
          ? `<span class="badge disabled">Disabled</span>`
          : r.authenticated
            ? `<span class="badge ok">Authenticated</span>`
            : `<span class="badge warn">Not Authenticated</span>`;

        const activeBadge = r.isActive
          ? `<span class="badge active">Active</span>`
          : "";

        const enableBtn = `<button class="btn btn-sm" onclick="send('toggleEnabled','${r.id}')">${r.enabled ? "Disable" : "Enable"}</button>`;

        const setActiveBtn =
          r.enabled && !r.isActive
            ? `<button class="btn btn-sm btn-primary" onclick="send('setActive','${r.id}')">Set Active</button>`
            : "";

        let authActions = "";
        if (r.enabled && r.id !== "copilot") {
          if (r.authenticated) {
            authActions = `<button class="btn btn-sm btn-danger" onclick="send('signOut','${r.id}')">Sign Out</button>`;
          } else {
            authActions = `
              <button class="btn btn-sm btn-primary" onclick="send('signIn','${r.id}')">Sign In</button>
              <button class="btn btn-sm" onclick="send('setApiKey','${r.id}')">Set API Key</button>`;
          }
        }

        return `
          <tr class="${!r.enabled ? "row-disabled" : ""}">
            <td><strong>${r.name}</strong> ${activeBadge}</td>
            <td>${statusBadge}</td>
            <td>${r.enabled ? r.authMethod : "—"}</td>
            <td class="model-cell">${r.enabled ? r.model : "—"}</td>
            <td class="actions">${enableBtn} ${setActiveBtn} ${authActions}</td>
          </tr>`;
      })
      .join("\n");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, var(--vscode-widget-border, #444));
    --btn-bg: var(--vscode-button-secondaryBackground, #3a3a3a);
    --btn-fg: var(--vscode-button-secondaryForeground, #ccc);
    --btn-primary-bg: var(--vscode-button-background, #0078d4);
    --btn-primary-fg: var(--vscode-button-foreground, #fff);
    --badge-ok: #2ea043;
    --badge-warn: #d29922;
    --badge-disabled: #6e7681;
    --badge-active: #1f6feb;
    --row-disabled-opacity: 0.5;
    --hover: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--fg);
    background: var(--bg);
    padding: 24px;
  }
  h1 { font-size: 1.4em; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: var(--vscode-descriptionForeground, #999); margin-bottom: 20px; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  th {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 2px solid var(--border);
    font-weight: 600;
    white-space: nowrap;
  }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  tr:hover { background: var(--hover); }
  tr.row-disabled td { opacity: var(--row-disabled-opacity); }
  .model-cell {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
  }
  .badge {
    display: inline-block;
    font-size: 0.8em;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .badge.ok { background: var(--badge-ok); color: #fff; }
  .badge.warn { background: var(--badge-warn); color: #000; }
  .badge.disabled { background: var(--badge-disabled); color: #fff; }
  .badge.active { background: var(--badge-active); color: #fff; }
  .actions { white-space: nowrap; }
  .btn {
    display: inline-block;
    padding: 4px 10px;
    margin: 0 2px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--btn-bg);
    color: var(--btn-fg);
    cursor: pointer;
    font-size: 0.88em;
    font-family: inherit;
  }
  .btn:hover { opacity: 0.85; }
  .btn-primary {
    background: var(--btn-primary-bg);
    color: var(--btn-primary-fg);
    border-color: var(--btn-primary-bg);
  }
  .btn-danger {
    background: #c9352b;
    color: #fff;
    border-color: #c9352b;
  }
  .btn-sm { padding: 3px 8px; font-size: 0.84em; }
  .footer {
    margin-top: 12px;
    display: flex;
    gap: 8px;
  }
</style>
</head>
<body>
  <h1>AI Providers</h1>
  <p class="subtitle">Manage authentication and models for AI-generated commit messages.</p>

  <table>
    <thead>
      <tr>
        <th>Provider</th>
        <th>Status</th>
        <th>Auth Method</th>
        <th>Model</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="footer">
    <button class="btn" onclick="send('selectModel')">Change Model</button>
    <button class="btn" onclick="send('openSettings')">All Settings</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function send(command, providerId) {
      vscode.postMessage({ command, providerId });
    }
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
    ProviderWebviewPanel.instance = undefined;
  }
}
