export interface AIOptions {
  customInstructions?: string;
  useEmojis?: boolean;
  model?: string;
  maxDiffChars?: number;
}

export interface AIModelInfo {
  id: string;
  displayName?: string;
  createdAtMs?: number;
}

export interface AIProvider {
  id: string;
  name: string;
  isAvailable(): Promise<boolean>;
  generateCommitMessage(diff: string, options: AIOptions): Promise<string>;
  listModels?(): Promise<AIModelInfo[]>;
  dispose?(): void;
}
