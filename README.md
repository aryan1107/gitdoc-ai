# GitDoc AI

Automatically commit, push, and pull changes on save with AI-generated commit messages powered by **Claude**, **OpenAI**, or **GitHub Copilot**.

## Features

- **Auto-commit on save** — Every file save triggers an automatic commit with an AI-generated message
- **AI-powered commit messages** — Uses Claude, OpenAI, or Copilot to describe your changes
- **Auto-push & auto-pull** — Keep your remote in sync automatically
- **Multiple AI providers** — Choose between Anthropic Claude, OpenAI, or GitHub Copilot
- **Flexible authentication** — API keys, CLI login (Claude Code / Codex), or Copilot extension
- **Provider Manager** — Interactive panel to manage providers, auth status, and models
- **Timeline integration** — Squash, undo, and restore versions from the VS Code timeline
- **Configurable** — Custom commit delays, file patterns, branch exclusions, and more

## Quick Start

1. Install the extension
2. Open a Git repository in VS Code
3. Run **GitDoc AI: Sign In to AI Provider** from the command palette
4. Run **GitDoc AI: Enable** to start auto-committing

## AI Providers

| Provider | Auth Methods | Default Model |
|----------|-------------|---------------|
| **OpenAI** | API Key, Codex CLI login | gpt-4.1 |
| **Claude** | API Key, Claude Code CLI login | claude-sonnet-4-5 |
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

| Setting | Default | Description |
|---------|---------|-------------|
| `gitdocAI.enabled` | `false` | Enable auto-commit on save |
| `gitdocAI.ai.enabled` | `true` | Use AI for commit messages |
| `gitdocAI.ai.provider` | `openai` | Active AI provider |
| `gitdocAI.autoCommitDelay` | `30000` | Delay (ms) before auto-committing |
| `gitdocAI.autoPush` | `onCommit` | When to auto-push (`onCommit`, `afterDelay`, `off`) |
| `gitdocAI.autoPull` | `onPush` | When to auto-pull (`onPush`, `afterDelay`, `off`) |
| `gitdocAI.ai.customInstructions` | `""` | Custom instructions for AI (e.g., "use conventional commits") |
| `gitdocAI.filePattern` | `**/*` | Glob pattern for files to auto-commit |
| `gitdocAI.excludeBranches` | `[]` | Branches to exclude from auto-commits |

## Requirements

- VS Code 1.85.0 or later
- A Git repository
- One of: Anthropic API key, OpenAI API key, Claude Code CLI, Codex CLI, or GitHub Copilot extension

## License

MIT

## Support

- [Report issues](https://github.com/aryan1107/gitdoc-ai/issues)
- [Source code](https://github.com/aryan1107/gitdoc-ai)
