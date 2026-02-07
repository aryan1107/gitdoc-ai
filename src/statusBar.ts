import * as vscode from "vscode";
import { EXTENSION_ID } from "./constants";

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = `${EXTENSION_ID}.disable`;
  }

  show(): void {
    this.updateStatus("enabled");
    this.statusBarItem.show();
  }

  hide(): void {
    this.statusBarItem.hide();
  }

  updateStatus(status: string): void {
    switch (status) {
      case "enabled":
        this.statusBarItem.text = "$(mirror) GitDoc AI";
        this.statusBarItem.tooltip = "GitDoc AI is enabled. Click to disable.";
        this.statusBarItem.command = `${EXTENSION_ID}.disable`;
        break;
      case "syncing":
        this.statusBarItem.text = "$(sync~spin) GitDoc AI";
        this.statusBarItem.tooltip = "GitDoc AI is syncing...";
        this.statusBarItem.command = undefined;
        break;
      case "error":
        this.statusBarItem.text = "$(error) GitDoc AI";
        this.statusBarItem.tooltip = "GitDoc AI encountered an error. Click to see output.";
        this.statusBarItem.command = `${EXTENSION_ID}.showOutput`;
        break;
      case "disabled":
        this.statusBarItem.text = "$(mirror) GitDoc AI (off)";
        this.statusBarItem.tooltip = "GitDoc AI is disabled. Click to enable.";
        this.statusBarItem.command = `${EXTENSION_ID}.enable`;
        break;
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
