export interface GitCommitResult {
  success: boolean;
  commitHash?: string;
  message?: string;
  error?: string;
}

export interface GitPushResult {
  success: boolean;
  error?: string;
}

export interface GitPullResult {
  success: boolean;
  error?: string;
}

export interface GitDiffResult {
  diff: string;
  files: string[];
}
