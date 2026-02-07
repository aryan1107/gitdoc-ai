import { AIOptions } from "./types";

export function buildCommitSystemPrompt(options: AIOptions): string {
  let prompt = `You are a git commit message generator. Given a git diff, write a concise, meaningful commit message.

Rules:
- Use imperative mood (e.g., "Add feature" not "Added feature")
- Keep the message on a single line, under 72 characters
- Be specific about what changed
- Output ONLY the commit message, nothing else`;

  if (options.useEmojis) {
    prompt += "\n- Prepend an appropriate emoji to the message";
  }

  if (options.customInstructions) {
    prompt += `\n- Additional instructions: ${options.customInstructions}`;
  }

  return prompt;
}

export function normalizeCommitMessage(message: string): string {
  let cleaned = message.trim();

  // Strip markdown code fences (```...```)
  cleaned = cleaned.replace(/^```[\s\S]*?\n([\s\S]*?)\n```$/g, "$1").trim();

  // Strip surrounding backticks
  if (cleaned.startsWith("`") && cleaned.endsWith("`")) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Strip surrounding double quotes
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Strip surrounding single quotes
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Collapse whitespace to single spaces (keep it on one line)
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

export function truncateDiffForAI(diff: string, options: AIOptions): string {
  const configured = options.maxDiffChars;
  const maxDiffLength = Math.max(
    500,
    Number.isFinite(configured) ? configured! : 200000
  );

  return diff.length > maxDiffLength
    ? diff.substring(0, maxDiffLength) + "\n... (diff truncated)"
    : diff;
}

