import * as vscode from "vscode";
import * as path from "path";
import { DateTime } from "luxon";
import { minimatch } from "minimatch";
import { config } from "../config";
import {
  execGit,
  getWorkingDirectory,
  hasChanges,
  getCurrentBranch,
  hasRemote,
  hasUpstream,
  getStagedDiff,
  getChangedFiles,
} from "./gitUtils";
import { AIManager } from "../ai/aiManager";
import { normalizeCommitMessage } from "../ai/prompt";

export class GitManager implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private commitTimer: ReturnType<typeof setTimeout> | undefined;
  private pushTimer: ReturnType<typeof setInterval> | undefined;
  private pullTimer: ReturnType<typeof setInterval> | undefined;
  private enabled = false;
  private lastSavedDocumentUri: vscode.Uri | undefined;
  private preferredWorkingDirectory: string | undefined;
  private isCommitting = false;
  private isPushing = false;
  private isPulling = false;
  private outputChannel: vscode.OutputChannel;
  private aiManager: AIManager;
  private onStatusChangeEmitter = new vscode.EventEmitter<string>();
  public onStatusChange = this.onStatusChangeEmitter.event;

  constructor(
    outputChannel: vscode.OutputChannel,
    aiManager: AIManager
  ) {
    this.outputChannel = outputChannel;
    this.aiManager = aiManager;
  }

  async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }

    this.enabled = true;
    this.log("GitDoc AI enabled");

    // Listen for file saves
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onFileSaved(doc))
    );

    await this.refreshConfiguration();

    // Pull on open if configured
    if (config.pullOnOpen) {
      const cwd = await this.getTargetWorkingDirectory();
      if (cwd && !(await hasChanges(cwd))) {
        await this.pull(cwd);
      } else {
        this.log("Skipping pull on open: local changes detected", "debug");
      }
    }
  }

  disable(): void {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;
    this.log("GitDoc AI disabled");
    this.clearTimers();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.onStatusChangeEmitter.fire("disabled");
  }

  private clearTimers(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = undefined;
    }
    this.clearSyncTimers();
  }

  private clearSyncTimers(): void {
    if (this.pushTimer) {
      clearInterval(this.pushTimer);
      this.pushTimer = undefined;
    }
    if (this.pullTimer) {
      clearInterval(this.pullTimer);
      this.pullTimer = undefined;
    }
  }

  private async onFileSaved(document: vscode.TextDocument): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const cwd = await getWorkingDirectory(document.uri);
    if (!cwd) return;
    this.preferredWorkingDirectory = cwd;
    this.lastSavedDocumentUri = document.uri;

    // Check if file matches the configured pattern
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    if (!minimatch(relativePath, config.filePattern)) {
      return;
    }

    // Check if current branch is excluded
    try {
      const branch = await getCurrentBranch(cwd);
      if (config.excludeBranches.includes(branch)) {
        return;
      }
    } catch {
      return;
    }

    // Preserve original behavior: validate only the saved file.
    if (config.commitValidationLevel !== "none") {
      const diagnostics = vscode.languages.getDiagnostics(document.uri);
      const minSeverity =
        config.commitValidationLevel === "error"
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning;

      const hasProblems = diagnostics.some((d) => d.severity <= minSeverity);
      if (hasProblems) {
        this.log(
          `Skipping commit: ${relativePath} has ${config.commitValidationLevel}-level problems`
        );
        return;
      }
    }

    // Debounce the commit
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
    }

    this.commitTimer = setTimeout(() => {
      void this.commit(cwd);
    }, config.autoCommitDelay);
  }

  async commit(cwdOverride?: string): Promise<boolean> {
    if (this.isCommitting) return false;

    const cwd = await this.resolveWorkingDirectory(cwdOverride);
    if (!cwd) return false;

    try {
      this.isCommitting = true;
      this.onStatusChangeEmitter.fire("syncing");

      this.log(`Starting commit in: ${cwd}`, "debug");
      this.log(
        `Config: ai.enabled=${config.aiEnabled}, provider=${config.aiProvider}, authMethod=${config.authMethod}`,
        "debug"
      );

      // Check if there are changes
      if (!(await hasChanges(cwd))) {
        this.log("No changes to commit");
        this.onStatusChangeEmitter.fire("enabled");
        return false;
      }

      // Stage all matching changes
      const changedFiles = await getChangedFiles(cwd);
      this.log(`Changed files (${changedFiles.length}): ${changedFiles.join(", ")}`, "debug");
      const matchingFiles = changedFiles.filter((f) =>
        minimatch(f, config.filePattern)
      );

      if (matchingFiles.length === 0) {
        this.log("No matching files to commit");
        this.onStatusChangeEmitter.fire("enabled");
        return false;
      }

      this.log(`Staging ${matchingFiles.length} file(s)...`, "debug");

      // Stage the matching files
      let stagedAny = false;
      for (const file of matchingFiles) {
        const normalizedPath = this.normalizeGitPath(file, cwd);
        if (!normalizedPath) {
          this.log(`Skipping non-repo path: ${file}`, "debug");
          continue;
        }
        try {
          await execGit(["add", "--", normalizedPath], cwd);
          stagedAny = true;
        } catch (error: any) {
          const message = String(error?.message || error);
          if (this.isSubmodulePathspecError(message)) {
            this.log(
              `Skipping submodule-internal path while staging: ${normalizedPath}`,
              "debug"
            );
            continue;
          }
          if (this.isIgnoredFileError(message)) {
            this.log(
              `Skipping gitignored file: ${normalizedPath}`,
              "debug"
            );
            continue;
          }
          if (this.isPathspecNoMatchError(message)) {
            this.log(
              `Skipping unresolvable path: ${normalizedPath}`,
              "debug"
            );
            continue;
          }
          throw error;
        }
      }

      if (!stagedAny) {
        this.log("No stageable files found for commit");
        this.onStatusChangeEmitter.fire("enabled");
        return false;
      }

      // Get staged diff after staging so newly added files are included.
      let diff = "";
      if (config.aiEnabled) {
        this.log("AI is enabled, getting staged diff...", "debug");
        try {
          diff = await getStagedDiff(cwd);
          this.log(`Staged diff length: ${diff.length} chars`, "debug");
        } catch (diffError: any) {
          const detail = diffError?.message || String(diffError);
          this.log(`Failed to get staged diff: ${detail}`, "error");
          throw new Error(`AI-enabled commit aborted: failed to get staged diff: ${detail}`);
        }
      } else {
        this.log("AI is disabled (gitdocAI.ai.enabled=false), using timestamp", "debug");
      }

      // Generate commit message
      let message: string;
      if (config.aiEnabled) {
        if (!diff) {
          throw new Error(
            "AI-enabled commit aborted: staged diff is empty, so AI commit message could not be generated."
          );
        }
        this.log("Requesting AI commit message...");
        try {
          message = await this.aiManager.generateCommitMessage(diff);
          this.log(`AI returned message: "${message}"`, "debug");
        } catch (error: any) {
          const detail = error?.message || String(error);
          this.log(`AI commit message failed: ${detail}`, "error");
          this.log("Falling back to timestamp message", "debug");
          message = this.getTimestampMessage();
        }
      } else {
        message = this.getTimestampMessage();
      }

      message = normalizeCommitMessage(message);
      if (!message) {
        this.log("Commit message is empty after normalization, using timestamp", "info");
        message = this.getTimestampMessage();
      }

      // Commit
      const commitArgs = ["commit", "-m", message];
      if (config.noVerify) {
        commitArgs.push("--no-verify");
      }
      await execGit(commitArgs, cwd);

      this.log(`Committed: ${message}`);

      // Auto-push if configured
      if (config.autoPush === "onCommit") {
        await this.push(cwd);
      }

      this.onStatusChangeEmitter.fire("enabled");
      return true;
    } catch (error: any) {
      this.log(`Commit failed: ${error.message}`, "error");
      this.showOutputOnError();
      this.onStatusChangeEmitter.fire("error");
      return false;
    } finally {
      this.isCommitting = false;
    }
  }

  async push(cwdOverride?: string): Promise<boolean> {
    if (this.isPushing) return false;

    const cwd = await this.resolveWorkingDirectory(cwdOverride);
    if (!cwd) return false;

    try {
      // Check if remote exists
      if (!(await hasRemote(cwd))) {
        this.log("No remote configured, skipping push");
        return false;
      }

      this.isPushing = true;
      this.onStatusChangeEmitter.fire("syncing");

      const branch = await getCurrentBranch(cwd);
      let pushArgs: string[] = ["push"];

      // Set upstream if needed
      if (!(await hasUpstream(cwd))) {
        pushArgs = ["push", "-u", "origin", branch];
      } else {
        switch (config.pushMode) {
          case "forcePush":
            pushArgs = ["push", "--force"];
            break;
          case "forcePushWithLease":
            pushArgs = ["push", "--force-with-lease"];
            break;
          case "push":
            pushArgs = ["push"];
            break;
        }
      }

      await execGit(pushArgs, cwd);
      this.log("Pushed changes");

      // Auto-pull after push if configured
      if (config.autoPull === "onPush") {
        await this.pull(cwd);
      }

      this.onStatusChangeEmitter.fire("enabled");
      return true;
    } catch (error: any) {
      this.log(`Push failed: ${error.message}`, "error");
      this.showOutputOnError();
      this.onStatusChangeEmitter.fire("error");
      return false;
    } finally {
      this.isPushing = false;
    }
  }

  async pull(cwdOverride?: string): Promise<boolean> {
    if (this.isPulling) return false;

    const cwd = await this.resolveWorkingDirectory(cwdOverride);
    if (!cwd) return false;

    try {
      if (!(await hasRemote(cwd))) {
        return false;
      }

      if (!(await hasUpstream(cwd))) {
        return false;
      }

      this.isPulling = true;
      this.onStatusChangeEmitter.fire("syncing");

      await execGit(["pull", "--rebase"], cwd);
      this.log("Pulled changes");

      this.onStatusChangeEmitter.fire("enabled");
      return true;
    } catch (error: any) {
      this.log(`Pull failed: ${error.message}`, "error");
      this.showOutputOnError();
      this.onStatusChangeEmitter.fire("error");
      return false;
    } finally {
      this.isPulling = false;
    }
  }

  async squashAbove(commitHash: string, message: string): Promise<boolean> {
    const cwd = await this.getTargetWorkingDirectory();
    if (!cwd) return false;

    try {
      // Get the parent of the target commit
      const { stdout } = await execGit(["rev-parse", `${commitHash}~1`], cwd);
      const parentHash = stdout.trim();

      await execGit(["reset", "--soft", parentHash], cwd);
      const commitMessage =
        normalizeCommitMessage(message) || this.getTimestampMessage();
      const commitArgs = ["commit", "-m", commitMessage];
      if (config.noVerify) {
        commitArgs.push("--no-verify");
      }
      await execGit(commitArgs, cwd);

      this.log(`Squashed versions above ${commitHash}`);
      return true;
    } catch (error: any) {
      this.log(`Squash failed: ${error.message}`, "error");
      this.showOutputOnError();
      vscode.window.showErrorMessage(`Failed to squash versions: ${error.message}`);
      return false;
    }
  }

  async undoVersion(commitHash: string): Promise<boolean> {
    const cwd = await this.getTargetWorkingDirectory();
    if (!cwd) return false;

    try {
      const revertArgs = ["revert", "--no-edit"];
      if (config.noVerify) {
        revertArgs.push("--no-verify");
      }
      revertArgs.push(commitHash);
      await execGit(revertArgs, cwd);
      this.log(`Undid version ${commitHash}`);
      return true;
    } catch (error: any) {
      this.log(`Undo failed: ${error.message}`, "error");
      this.showOutputOnError();
      vscode.window.showErrorMessage(`Failed to undo version: ${error.message}`);
      return false;
    }
  }

  async restoreVersion(commitHash: string, filePath: string): Promise<boolean> {
    const cwd = await this.getTargetWorkingDirectory();
    if (!cwd) return false;

    try {
      await execGit(["checkout", commitHash, "--", filePath], cwd);
      const restoreMessage = normalizeCommitMessage(
        `Restore ${filePath} to ${commitHash.substring(0, 7)}`
      );
      const commitArgs = ["commit", "-m", restoreMessage];
      if (config.noVerify) {
        commitArgs.push("--no-verify");
      }
      await execGit(commitArgs, cwd);
      this.log(`Restored ${filePath} to ${commitHash}`);
      return true;
    } catch (error: any) {
      this.log(`Restore failed: ${error.message}`, "error");
      this.showOutputOnError();
      vscode.window.showErrorMessage(`Failed to restore version: ${error.message}`);
      return false;
    }
  }

  async commitOnClose(): Promise<void> {
    if (!config.commitOnClose) return;

    const cwd = await this.getTargetWorkingDirectory();
    if (!cwd) return;

    if (await hasChanges(cwd)) {
      await this.commit(cwd);
    }
  }

  async refreshConfiguration(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    this.clearSyncTimers();

    if (config.autoPull === "afterDelay") {
      this.startPullTimer();
    }

    if (config.autoPush === "afterDelay") {
      this.startPushTimer();
    }
  }

  private getTimestampMessage(): string {
    const format = config.commitMessageFormat;
    const zone = config.timeZone.trim();
    const dateTime = zone.length > 0 ? DateTime.now().setZone(zone) : DateTime.now();
    return dateTime.toFormat(format);
  }

  private normalizeGitPath(filePath: string, cwd: string): string | undefined {
    if (!path.isAbsolute(filePath)) {
      return filePath;
    }

    const relativePath = path.relative(cwd, filePath);
    if (
      relativePath.length === 0 ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      return undefined;
    }

    return relativePath;
  }

  private isSubmodulePathspecError(message: string): boolean {
    return /pathspec .* is in submodule/i.test(message);
  }

  private isIgnoredFileError(message: string): boolean {
    return message.includes("ignored by one of your .gitignore files");
  }

  private isPathspecNoMatchError(message: string): boolean {
    return message.includes("did not match any files");
  }

  private async resolveWorkingDirectory(
    cwdOverride?: string
  ): Promise<string | undefined> {
    if (cwdOverride) {
      this.preferredWorkingDirectory = cwdOverride;
      return cwdOverride;
    }
    if (this.preferredWorkingDirectory) {
      return this.preferredWorkingDirectory;
    }
    return this.getTargetWorkingDirectory();
  }

  private async getTargetWorkingDirectory(): Promise<string | undefined> {
    const activeUri =
      this.lastSavedDocumentUri ?? vscode.window.activeTextEditor?.document.uri;
    const cwd = await getWorkingDirectory(activeUri);
    if (cwd) {
      this.preferredWorkingDirectory = cwd;
    }
    return cwd;
  }

  private startPushTimer(): void {
    if (this.pushTimer) {
      clearInterval(this.pushTimer);
    }
    this.pushTimer = setInterval(() => {
      void this.push();
    }, config.autoPushDelay);
  }

  private startPullTimer(): void {
    if (this.pullTimer) {
      clearInterval(this.pullTimer);
    }
    this.pullTimer = setInterval(() => {
      void this.pull();
    }, config.autoPullDelay);
  }

  private log(message: string, level: "error" | "info" | "debug" = "info"): void {
    if (!this.shouldLog(level)) {
      return;
    }
    const timestamp = DateTime.now().toFormat("HH:mm:ss");
    this.outputChannel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }

  private shouldLog(level: "error" | "info" | "debug"): boolean {
    const weights = { error: 0, info: 1, debug: 2 } as const;
    return weights[level] <= weights[config.logLevel];
  }

  private showOutputOnError(): void {
    if (config.showOutputOnError) {
      this.outputChannel.show(true);
    }
  }

  dispose(): void {
    this.disable();
    this.onStatusChangeEmitter.dispose();
  }
}
