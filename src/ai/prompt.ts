import { AIOptions } from "./types";

export function buildCommitSystemPrompt(options: AIOptions): string {
  const lengthLimit = getMaxCharacterLength(options.commitMessageLength);
  const styleInstructions = getStyleInstructions(options.commitMessageStyle);

  let prompt = `You are a git commit message generator. Given a git diff, write a concise, meaningful commit message.

Rules:
- Use imperative mood (e.g., "Add feature" not "Added feature")
- Keep the message on a single line, under ${lengthLimit} characters
- Be specific about what changed
- Output ONLY the commit message, nothing else`;

  if (styleInstructions) {
    prompt += `\n${styleInstructions}`;
  }

  if (options.useEmojis && options.commitMessageStyle !== "emoji") {
    prompt += "\n- Prepend an appropriate emoji to the message";
  }

  if (options.customInstructions && options.commitMessageStyle !== "custom") {
    prompt += `\n- Additional instructions: ${options.customInstructions}`;
  }

  // For custom style, use only custom instructions
  if (options.commitMessageStyle === "custom" && options.customInstructions) {
    prompt = `You are a git commit message generator. Given a git diff, write a commit message following these instructions:

${options.customInstructions}

Keep the message under ${lengthLimit} characters and output ONLY the commit message, nothing else.`;
  }

  return prompt;
}

function getMaxCharacterLength(length?: "short" | "standard" | "detailed"): number {
  switch (length) {
    case "short":
      return 50;
    case "detailed":
      return 100;
    case "standard":
    default:
      return 72;
  }
}

function getStyleInstructions(style?: "simple" | "conventional" | "emoji" | "custom"): string | null {
  switch (style) {
    case "conventional":
      return `- Use Conventional Commits format: <type>: <description>
- Valid types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert
- Example: "feat: add user authentication" or "fix: resolve memory leak"`;

    case "emoji":
      return `- Start the message with an appropriate emoji:
  - ✨ New feature
  - 🐛 Bug fix
  - 📝 Documentation
  - ♻️ Refactor
  - 🎨 Style/format
  - ⚡ Performance
  - ✅ Tests
  - 🔧 Configuration
  - 🚀 Deployment
- Example: "✨ add user authentication" or "🐛 fix memory leak"`;

    case "simple":
    case "custom":
    default:
      return null;
  }
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

