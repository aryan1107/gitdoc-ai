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

export async function hasChanges(cwd: string): Promise<boolean> {
  const { stdout } = await execGit(["status", "--porcelain"], cwd);
  return stdout.trim().length > 0;
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
