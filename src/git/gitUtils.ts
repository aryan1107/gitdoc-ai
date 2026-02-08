import * as vscode from "vscode";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

export async function execGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, {
      cwd,
      maxBuffer: MAX_BUFFER,
    });
  } catch (error: any) {
    const stderr = error?.stderr?.toString().trim();
    const stdout = error?.stdout?.toString().trim();
    throw new Error(stderr || stdout || error.message);
  }
}

export async function getWorkingDirectory(
  uri?: vscode.Uri
): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  if (uri && uri.scheme === "file") {
    const repoRoot = await getGitRootForPath(uri.fsPath);
    if (repoRoot) {
      return repoRoot;
    }

    const containingFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (containingFolder) {
      const folderRoot = await getGitRootForPath(containingFolder.uri.fsPath);
      return folderRoot || containingFolder.uri.fsPath;
    }
  }

  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  for (const folder of folders) {
    const repoRoot = await getGitRootForPath(folder.uri.fsPath);
    if (repoRoot) {
      return repoRoot;
    }
  }

  return undefined;
}

async function getGitRootForPath(fsPath: string): Promise<string | undefined> {
  try {
    const stats = await fs.stat(fsPath);
    const startDir = stats.isDirectory() ? fsPath : path.dirname(fsPath);
    const { stdout } = await execFileAsync(
      "git",
      ["-C", startDir, "rev-parse", "--show-toplevel"],
      { maxBuffer: MAX_BUFFER }
    );
    const repoRoot = stdout.trim();
    return repoRoot.length > 0 ? repoRoot : undefined;
  } catch {
    return undefined;
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return stdout.trim();
}

export async function getStagedDiff(cwd: string): Promise<string> {
  const { stdout } = await execGit(["diff", "--cached"], cwd);
  return stdout;
}

export async function getUnstagedDiff(cwd: string): Promise<string> {
  const { stdout } = await execGit(["diff"], cwd);
  return stdout;
}

export async function getFullDiff(cwd: string): Promise<string> {
  const { stdout } = await execGit(["diff", "HEAD"], cwd);
  return stdout.trim();
}

export async function getStagedDiffWithContext(
  cwd: string,
  contextDepth: number
): Promise<string> {
  // Get staged diff
  const stagedDiff = await getStagedDiff(cwd);

  // If no context requested, return staged diff only
  if (contextDepth === 0) {
    return stagedDiff;
  }

  try {
    // Get diff from HEAD~N to HEAD for context
    const commitRef = `HEAD~${contextDepth}`;
    const { stdout: contextDiff } = await execGit(
      ["diff", commitRef, "HEAD"],
      cwd
    );

    // Combine context with staged changes
    let combined = "";
    if (contextDiff.trim()) {
      combined += `# Recent changes (last ${contextDepth} commit${contextDepth > 1 ? "s" : ""}):\n${contextDiff}\n\n`;
    }
    if (stagedDiff.trim()) {
      combined += `# Staged changes:\n${stagedDiff}`;
    }

    return combined || stagedDiff;
  } catch (error) {
    // If we can't get context (e.g., not enough commits), fall back to staged only
    return stagedDiff;
  }
}

export async function hasChanges(cwd: string): Promise<boolean> {
  const { stdout } = await execGit(["status", "--porcelain"], cwd);
  return stdout.trim().length > 0;
}

export async function getChangeStats(cwd: string): Promise<{ filesChanged: number; linesChanged: number }> {
  try {
    // Get numstat for staged changes
    const { stdout } = await execGit(["diff", "--cached", "--numstat"], cwd);

    const lines = stdout.trim().split("\n").filter(line => line);
    const filesChanged = lines.length;

    let linesChanged = 0;
    for (const line of lines) {
      const parts = line.split("\t");
      const addedStr = parts[0];
      const deletedStr = parts[1];

      // Binary files show "-" for both added and deleted
      if (addedStr === "-" || deletedStr === "-") {
        // Count binary files as at least 1 line changed
        linesChanged += 1;
      } else {
        const added = parseInt(addedStr) || 0;
        const deleted = parseInt(deletedStr) || 0;
        linesChanged += added + deleted;
      }
    }

    return { filesChanged, linesChanged };
  } catch (error) {
    return { filesChanged: 0, linesChanged: 0 };
  }
}

function parsePorcelainStatus(output: string): string[] {
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  const files = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) {
      continue;
    }

    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    if (path) {
      files.add(path);
    }

    // In porcelain -z mode, rename/copy entries include a second path that we skip.
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      i += 1;
    }
  }

  return Array.from(files);
}

export async function getChangedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execGit(["status", "--porcelain", "-z"], cwd);
  return parsePorcelainStatus(stdout);
}

export async function hasRemote(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execGit(["remote"], cwd);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function hasUpstream(cwd: string): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd);
    return true;
  } catch {
    return false;
  }
}
