# GitDoc AI

Automatically commit, push, and pull changes on save with AI-generated commit messages powered by **Claude**, **OpenAI**, or **GitHub Copilot**.

## Features

- **Auto-commit on save** — Every file save triggers an automatic commit with an AI-generated message
- **AI-powered commit messages** — Uses Claude, OpenAI, or Copilot to describe your changes
- **Multiple commit styles** — Simple, Conventional Commits, Emoji-first, or fully custom
- **Smart context** — Include recent commit history for better AI understanding
- **Configurable thresholds** — Only commit when X files or Y lines changed
- **Retry logic** — Automatically retry on AI failures before falling back
- **Auto-push & auto-pull** — Keep your remote in sync automatically
- **Multiple AI providers** — Choose between Anthropic Claude, OpenAI, or GitHub Copilot
- **Flexible authentication** — API keys, CLI login (Claude Code / Codex), or Copilot extension
- **Provider Manager** — Interactive panel to manage providers, auth status, and models
- **Timeline integration** — Squash, undo, and restore versions from the VS Code timeline
- **Smart notifications** — Customizable alerts for commits, errors, and sync operations
- **Highly configurable** — Fine-tune delays, message length, context depth, and more

## Quick Start

1. Install the extension
2. Open a Git repository in VS Code
3. Run **GitDoc AI: Sign In to AI Provider** from the command palette
4. Run **GitDoc AI: Enable** to start auto-committing

## AI Providers

| Provider | Auth Methods | Default Model |
|----------|-------------|---------------|
| **OpenAI** | API Key, Codex CLI login | gpt-4.1 (API Key) / gpt-5.1-codex-mini (Codex CLI) |
| **Claude** | API Key, Claude Code CLI login | claude-sonnet-4-5-20250929 |
| **Copilot** | GitHub Copilot extension | default |

### Authentication

**API Key** — Enter your key via `GitDoc AI: Set API Key`

**CLI Login** — Use your existing Claude Code or Codex CLI login:
- Claude: Run `claude` in terminal, complete `/login`
- OpenAI: Run `codex login` in terminal

**Copilot** — Install the GitHub Copilot extension and sign in

## Commands

| Command | Description |
|---------|-------------|
| `GitDoc AI: Enable` | Start auto-committing on save |
| `GitDoc AI: Disable` | Stop auto-committing |
| `GitDoc AI: Commit` | Manually trigger a commit |
| `GitDoc AI: Select AI Provider` | Choose between Claude, OpenAI, or Copilot |
| `GitDoc AI: Select Model` | Pick a specific model |
| `GitDoc AI: Sign In to AI Provider` | Authenticate with the active provider |
| `GitDoc AI: Set API Key` | Enter an API key for the active provider |
| `GitDoc AI: Manage Providers` | Open the provider management panel |

## Settings

### Core Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `gitdocAI.enabled` | `false` | Enable auto-commit on save |
| `gitdocAI.ai.enabled` | `true` | Use AI for commit messages |
| `gitdocAI.ai.provider` | `openai` | Active AI provider |
| `gitdocAI.autoCommitDelay` | `30000` | Delay (ms) before auto-committing |
| `gitdocAI.autoPush` | `onCommit` | When to auto-push (`onCommit`, `afterDelay`, `off`) |
| `gitdocAI.autoPull` | `onPush` | When to auto-pull (`onPush`, `afterDelay`, `off`) |
| `gitdocAI.filePattern` | `**/*` | Glob pattern used when auto-staging changed files |
| `gitdocAI.excludeBranches` | `[]` | Branches to exclude from auto-commits |

### AI Commit Message Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `gitdocAI.ai.commitMessageStyle` | `simple` | Commit style: `simple`, `conventional`, `emoji`, or `custom` |
| `gitdocAI.ai.commitMessageLength` | `standard` | Max length: `short` (50), `standard` (72), `detailed` (100) |
| `gitdocAI.ai.customInstructions` | `""` | Custom instructions for AI (e.g., "use conventional commits") |
| `gitdocAI.ai.diffContextDepth` | `0` | Include last N commits for context (0, 1, 2, 5, or 10) |
| `gitdocAI.ai.retryAttempts` | `1` | Number of AI retry attempts before fallback (1-5) |
| `gitdocAI.ai.retryDelayMs` | `2000` | Delay between retries in milliseconds |
| `gitdocAI.ai.fallbackToTimestampOnFailure` | `true` | Use timestamp message if AI fails after all retries (disable to abort commit instead) |

### Auto-Commit Thresholds
| Setting | Default | Description |
|---------|---------|-------------|
| `gitdocAI.autoCommit.minFilesChanged` | `1` | Minimum files changed to trigger commit |
| `gitdocAI.autoCommit.minLinesChanged` | `1` | Minimum lines changed to trigger commit |
| `gitdocAI.autoCommit.skipThresholdsForPreStaged` | `true` | Skip threshold checks when files were already staged before auto-commit runs |

Behavior notes:
- If files are already staged, saving any file triggers commit for the currently staged changes.
- By default, pre-staged files bypass threshold checks. Disable `skipThresholdsForPreStaged` to enforce thresholds against all staged files.

### Notifications
| Setting | Default | Description |
|---------|---------|-------------|
| `gitdocAI.notifications.onCommitSuccess` | `false` | Show notification on successful commit |
| `gitdocAI.notifications.onAIError` | `true` | Show notification on AI errors |
| `gitdocAI.notifications.onPushPull` | `false` | Show notifications for push/pull |

## Requirements

- VS Code 1.85.0 or later
- A Git repository
- One of: Anthropic API key, OpenAI API key, Claude Code CLI, Codex CLI, or GitHub Copilot extension

## License

MIT

## Support

- [Report issues](https://github.com/aryan1107/gitdoc-ai/issues)
- [Source code](https://github.com/aryan1107/gitdoc-ai)
