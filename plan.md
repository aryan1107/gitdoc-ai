# GitDoc AI - Project Plan

## Overview

**GitDoc AI** is a Visual Studio Code extension that automatically commits, pushes, and pulls changes on save — giving you the simplicity of a Google/Word Doc with the power of git history. It is inspired by the original [GitDoc extension](https://marketplace.visualstudio.com/items?itemName=vsls-contrib.gitdoc) by Jonathan Carter, but extends it with **multi-provider AI support** for generating semantic commit messages.

### What Makes GitDoc AI Different?

The original GitDoc extension only supports **GitHub Copilot** for AI-generated commit messages. GitDoc AI supports **three AI providers**:

| Provider | Authentication | Notes |
|----------|---------------|-------|
| **Anthropic (Claude)** | API Key or Claude Pro/Max login (OAuth) | Uses Claude Agent SDK |
| **OpenAI (Codex/GPT)** | API Key or ChatGPT Plus login (OAuth) | Uses OpenAI Codex SDK |
| **GitHub Copilot** | Copilot extension (existing VS Code auth) | Uses VS Code Language Model API |

Users can choose their preferred AI provider and authenticate either by:
1. **API Key** — Paste their API key directly in settings
2. **Account Login (OAuth)** — If they have a Pro/Plus subscription, they can log in and use without an API key

---

## Goals

1. **Auto-commit on save** — Automatically create git commits when files are saved
2. **Auto-push/pull** — Keep local and remote in sync automatically
3. **Multi-provider AI commit messages** — Generate meaningful commit messages using Claude, OpenAI, or Copilot
4. **Flexible authentication** — Support API keys and OAuth login for both Anthropic and OpenAI
5. **Backward compatible** — Support all the features from the original GitDoc (squash, undo, restore, file patterns, etc.)
6. **User-friendly settings** — Easy configuration through VS Code settings UI

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   VS Code Extension                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐│
│  │  Git Manager  │  │  AI Manager  │  │  Auth       ││
│  │              │  │              │  │  Manager    ││
│  │ - auto-commit│  │ - provider   │  │             ││
│  │ - auto-push  │  │   selection  │  │ - API keys  ││
│  │ - auto-pull  │  │ - message    │  │ - OAuth     ││
│  │ - squash     │  │   generation │  │ - session   ││
│  │ - undo       │  │              │  │   mgmt      ││
│  │ - restore    │  │              │  │             ││
│  └──────┬───────┘  └──────┬───────┘  └──────┬─────┘│
│         │                 │                  │       │
│         │    ┌────────────┴────────────┐     │       │
│         │    │    AI Provider Layer     │     │       │
│         │    ├────────────────────────┤     │       │
│         │    │ ┌────────┐ ┌────────┐ │     │       │
│         │    │ │Claude  │ │OpenAI  │ │     │       │
│         │    │ │Provider│ │Provider│ │     │       │
│         │    │ └────────┘ └────────┘ │     │       │
│         │    │ ┌────────┐            │     │       │
│         │    │ │Copilot │            │     │       │
│         │    │ │Provider│            │     │       │
│         │    │ └────────┘            │     │       │
│         │    └───────────────────────┘     │       │
│         │                                   │       │
├─────────┴───────────────────────────────────┴───────┤
│                  VS Code API / Git CLI                │
└─────────────────────────────────────────────────────┘
```

### Directory Structure

```
gitdoc-ai/
├── .vscode/
│   └── launch.json              # Extension debug config
├── src/
│   ├── extension.ts             # Extension entry point (activate/deactivate)
│   ├── config.ts                # Settings/configuration management
│   ├── constants.ts             # Shared constants
│   ├── git/
│   │   ├── gitManager.ts        # Core git operations (commit, push, pull)
│   │   ├── gitUtils.ts          # Git utility helpers
│   │   └── types.ts             # Git-related types
│   ├── ai/
│   │   ├── aiManager.ts         # AI provider orchestrator
│   │   ├── providers/
│   │   │   ├── base.ts          # Base AI provider interface
│   │   │   ├── claude.ts        # Anthropic Claude provider
│   │   │   ├── openai.ts        # OpenAI provider
│   │   │   └── copilot.ts       # GitHub Copilot provider
│   │   └── types.ts             # AI-related types
│   ├── auth/
│   │   ├── authManager.ts       # Authentication orchestrator
│   │   ├── anthropicAuth.ts     # Anthropic OAuth + API key auth
│   │   ├── openaiAuth.ts        # OpenAI OAuth + API key auth
│   │   └── secretStorage.ts     # Secure credential storage
│   ├── commands/
│   │   ├── enable.ts            # Enable GitDoc AI command
│   │   ├── disable.ts           # Disable GitDoc AI command
│   │   ├── commit.ts            # Manual commit command
│   │   ├── squash.ts            # Squash versions command
│   │   ├── undo.ts              # Undo version command
│   │   └── restore.ts           # Restore version command
│   ├── statusBar.ts             # Status bar management
│   └── timeline.ts              # Timeline provider for version history
├── resources/
│   └── icons/                   # Extension icons
├── package.json                 # Extension manifest
├── tsconfig.json                # TypeScript config
├── webpack.config.js            # Bundling config
├── plan.md                      # This file
├── calude-agent-doc.txt         # Claude Agent SDK documentation
├── openai-codex-doc.txt         # OpenAI Codex SDK documentation
└── README.md                    # User-facing documentation
```

---

## Implementation Plan

### Phase 1: Project Scaffolding & Core Git Functionality

**Goal:** Get a working VS Code extension that can auto-commit, auto-push, and auto-pull.

#### 1.1 Project Setup
- Initialize `package.json` with extension manifest (contributes: commands, settings, etc.)
- Set up TypeScript compilation (`tsconfig.json`)
- Set up webpack bundling (`webpack.config.js`)
- Create `.vscode/launch.json` for debugging
- Install dependencies: `@types/vscode`, `typescript`, `webpack`, etc.

#### 1.2 Core Git Manager (`src/git/gitManager.ts`)
- Implement file change detection using `vscode.workspace.onDidSaveTextDocument`
- Implement auto-commit with configurable delay (debounced)
- Implement auto-push (onCommit, afterDelay, off)
- Implement auto-pull (onPush, afterDelay, onOpen, off)
- Implement commit validation (check for errors/warnings in Problems panel)
- Implement file pattern filtering (glob-based)
- Implement branch exclusion
- Implement commit-on-close behavior

#### 1.3 Version Management Commands
- **Squash versions** — `git reset --soft` + `git commit`
- **Undo version** — `git revert`
- **Restore version** — `git checkout -- <file>` + `git commit`

#### 1.4 Status Bar
- Show GitDoc AI status (enabled/disabled/syncing)
- Click to toggle enable/disable
- Show sync status during push/pull operations

#### 1.5 Timeline Integration
- Register a `TimelineProvider` to show version history
- Context menu items for squash/undo/restore

---

### Phase 2: Authentication System

**Goal:** Support multiple authentication methods for AI providers.

#### 2.1 Secret Storage (`src/auth/secretStorage.ts`)
- Use `vscode.SecretStorage` API to securely store API keys and OAuth tokens
- Never store credentials in plain text settings

#### 2.2 Anthropic Authentication (`src/auth/anthropicAuth.ts`)
- **API Key mode**: User pastes `ANTHROPIC_API_KEY` in settings, stored in SecretStorage
- **OAuth mode** (Claude Pro/Max users):
  - Use VS Code's `AuthenticationProvider` API
  - Implement OAuth 2.0 PKCE flow against Anthropic's auth endpoints
  - Store and refresh tokens securely
  - Users with active Pro/Max subscription can use without API key

#### 2.3 OpenAI Authentication (`src/auth/openaiAuth.ts`)
- **API Key mode**: User pastes `OPENAI_API_KEY` in settings, stored in SecretStorage
- **OAuth mode** (ChatGPT Plus users):
  - Use VS Code's `AuthenticationProvider` API
  - Implement OAuth 2.0 flow against OpenAI's auth endpoints
  - Store and refresh tokens securely
  - Users with active Plus/Pro subscription can use without API key

#### 2.4 Auth Manager (`src/auth/authManager.ts`)
- Unified interface to get current credentials for any provider
- Handle auth state changes (login/logout/token refresh)
- Show login status in status bar
- Commands: `GitDoc AI: Sign In`, `GitDoc AI: Sign Out`

---

### Phase 3: AI-Powered Commit Messages

**Goal:** Generate meaningful commit messages using the user's preferred AI provider.

#### 3.1 Base Provider Interface (`src/ai/providers/base.ts`)
```typescript
interface AIProvider {
  id: string;
  name: string;
  isAvailable(): Promise<boolean>;
  generateCommitMessage(diff: string, options: AIOptions): Promise<string>;
}

interface AIOptions {
  customInstructions?: string;
  useEmojis?: boolean;
  model?: string;
}
```

#### 3.2 Claude Provider (`src/ai/providers/claude.ts`)
- Use `@anthropic-ai/sdk` (Anthropic TypeScript SDK) for API calls
- Send the git diff to Claude with a system prompt for commit message generation
- Support model selection (claude-sonnet-4-5-20250929, claude-opus-4-6, claude-haiku-4-5-20251001)
- Handle API errors gracefully (rate limits, auth failures)
- Fall back to timestamp-based messages on failure

#### 3.3 OpenAI Provider (`src/ai/providers/openai.ts`)
- Use `openai` (OpenAI TypeScript SDK) for API calls
- Send the git diff to GPT/Codex with a system prompt for commit message generation
- Support model selection (gpt-4o, gpt-4o-mini, o1, o3-mini)
- Handle API errors gracefully
- Fall back to timestamp-based messages on failure

#### 3.4 Copilot Provider (`src/ai/providers/copilot.ts`)
- Use VS Code's `vscode.lm.selectChatModels()` API
- Send the git diff through Copilot's language model API
- Works if user has Copilot extension installed and authenticated
- Fall back to timestamp-based messages on failure

#### 3.5 AI Manager (`src/ai/aiManager.ts`)
- Select the appropriate provider based on user settings
- Orchestrate commit message generation
- Handle provider fallbacks
- Cache/debounce API calls to avoid excessive usage

---

### Phase 4: Extension Settings & Commands

**Goal:** Full configuration through VS Code settings.

#### 4.1 Extension Settings (in `package.json` contributes.configuration)

**Core Settings:**
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gitdocAI.enabled` | boolean | false | Enable auto-commits on save |
| `gitdocAI.autoCommitDelay` | number | 30000 | Delay (ms) before auto-committing |
| `gitdocAI.autoPush` | enum | "onCommit" | When to auto-push (onCommit, afterDelay, off) |
| `gitdocAI.autoPushDelay` | number | 30000 | Delay (ms) before auto-pushing |
| `gitdocAI.autoPull` | enum | "onPush" | When to auto-pull (onPush, afterDelay, off) |
| `gitdocAI.autoPullDelay` | number | 30000 | Delay (ms) before auto-pulling |
| `gitdocAI.commitMessageFormat` | string | "LLL" | Date format for non-AI commits |
| `gitdocAI.commitValidationLevel` | enum | "error" | Problem severity to block commits (error, warning, none) |
| `gitdocAI.commitOnClose` | boolean | true | Auto-commit when VS Code closes |
| `gitdocAI.filePattern` | string | "**/*" | Glob for files to auto-commit |
| `gitdocAI.excludeBranches` | string[] | [] | Branches excluded from auto-commits |
| `gitdocAI.pushMode` | enum | "forcePush" | How to push (push, forcePush, forcePushWithLease) |
| `gitdocAI.pullOnOpen` | boolean | true | Pull remote changes on workspace open |
| `gitdocAI.noVerify` | boolean | false | Skip git hooks |

**AI Settings:**
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gitdocAI.ai.enabled` | boolean | false | Enable AI commit messages |
| `gitdocAI.ai.provider` | enum | "claude" | AI provider (claude, openai, copilot) |
| `gitdocAI.ai.model` | string | "" | Model override (auto-selects default per provider) |
| `gitdocAI.ai.customInstructions` | string | "" | Custom instructions for commit messages |
| `gitdocAI.ai.useEmojis` | boolean | false | Prepend emojis to commit messages |

**Auth Settings:**
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gitdocAI.auth.method` | enum | "apiKey" | Auth method (apiKey, login) |

#### 4.2 Extension Commands

| Command | Description | When Visible |
|---------|-------------|-------------|
| `gitdocAI.enable` | Enable GitDoc AI | When disabled |
| `gitdocAI.disable` | Disable GitDoc AI | When enabled |
| `gitdocAI.commit` | Manually trigger a commit | When enabled |
| `gitdocAI.signIn` | Sign in to AI provider | When not signed in |
| `gitdocAI.signOut` | Sign out from AI provider | When signed in |
| `gitdocAI.selectProvider` | Change AI provider | Always |
| `gitdocAI.setApiKey` | Set API key for current provider | Always |

#### 4.3 Timeline Context Menu Commands

| Command | Description |
|---------|-------------|
| `gitdocAI.squashAbove` | Squash all versions above selected |
| `gitdocAI.undoVersion` | Undo selected version |
| `gitdocAI.restoreVersion` | Restore selected version |

---

### Phase 5: Polish & Release

**Goal:** Production-ready extension.

#### 5.1 Error Handling & UX
- Graceful error messages for all failure modes
- Output channel for detailed logs (`GitDoc AI` output channel)
- Notification messages for key events (commit created, push succeeded, etc.)

#### 5.2 Testing
- Unit tests for git operations
- Unit tests for AI provider integrations
- Integration tests for the full commit flow

#### 5.3 Documentation
- README.md with screenshots, feature list, getting started guide
- CHANGELOG.md
- Extension icon and marketplace assets

#### 5.4 Publishing
- Package with `vsce package`
- Publish to VS Code Marketplace
- Create GitHub releases

---

## Authentication Flow Details

### API Key Flow
```
User → Settings → Paste API Key → SecretStorage → AI Provider → Commit Message
```

### OAuth Login Flow (Claude Pro / ChatGPT Plus)
```
User → "Sign In" Command → Browser OAuth → Callback → Token Storage → AI Provider → Commit Message
```

### Provider Auto-Detection
If the user hasn't explicitly chosen a provider, the extension will:
1. Check if Copilot is available → use Copilot
2. Check if Claude credentials exist → use Claude
3. Check if OpenAI credentials exist → use OpenAI
4. Fall back to timestamp-based commit messages

---

## Commit Message Generation Prompt

The AI providers will receive a prompt like:

```
You are a commit message generator. Given the following git diff, write a concise,
meaningful commit message that describes what changed and why.

Rules:
- Use imperative mood (e.g., "Add feature" not "Added feature")
- Keep the first line under 72 characters
- Be specific about what changed
{customInstructions}
{useEmojis ? "- Prepend an appropriate emoji to the message" : ""}

Git diff:
{diff}
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Anthropic API client for Claude |
| `openai` | OpenAI API client for GPT/Codex |
| `luxon` | Date/time formatting for commit messages |
| `minimatch` | Glob pattern matching for file filters |

**Dev Dependencies:**
| Package | Purpose |
|---------|---------|
| `@types/vscode` | VS Code API types |
| `typescript` | TypeScript compiler |
| `webpack` | Extension bundling |
| `webpack-cli` | Webpack CLI |
| `ts-loader` | TypeScript loader for webpack |
| `@vscode/vsce` | Extension packaging |

---

## Current Status

- [x] Project repository created
- [x] Claude Agent SDK documentation added (`calude-agent-doc.txt`)
- [x] OpenAI Codex SDK documentation added (`openai-codex-doc.txt`)
- [x] Project plan created (`plan.md`)
- [x] Phase 1: Project scaffolding & core git functionality
- [x] Phase 2: Authentication system
- [x] Phase 3: AI-powered commit messages
- [x] Phase 4: Extension settings & commands
- [ ] Phase 5: Polish & release

## What Has Been Implemented

### Files Created

| File | Purpose |
|------|---------|
| `package.json` | Extension manifest with all 19 settings, 10 commands, menus |
| `tsconfig.json` | TypeScript compilation config |
| `webpack.config.js` | Webpack bundling for extension |
| `.vscode/launch.json` | Debug configuration for Extension Host |
| `.vscode/tasks.json` | Watch mode build task |
| `.gitignore` | Ignore node_modules, dist, out |
| `.vscodeignore` | Files to exclude from .vsix package |
| `src/extension.ts` | Main entry point - activates on git repos, registers all commands |
| `src/config.ts` | Typed configuration accessor for all 19 settings |
| `src/constants.ts` | Shared constants (secret keys, model defaults, etc.) |
| `src/statusBar.ts` | Status bar manager with states: enabled, syncing, error, disabled |
| `src/git/types.ts` | TypeScript types for git operations |
| `src/git/gitUtils.ts` | Low-level git CLI wrappers (diff, status, branch, etc.) |
| `src/git/gitManager.ts` | Core auto-commit/push/pull engine with debouncing, validation, file filtering |
| `src/ai/types.ts` | AIProvider interface and AIOptions type |
| `src/ai/aiManager.ts` | AI provider orchestrator - selects provider, generates messages |
| `src/ai/providers/claude.ts` | Anthropic Claude provider using `@anthropic-ai/sdk` |
| `src/ai/providers/openai.ts` | OpenAI provider using `openai` SDK |
| `src/ai/providers/copilot.ts` | GitHub Copilot provider using `vscode.lm` API |
| `src/auth/authManager.ts` | Auth orchestrator - API key input, secure storage, sign in/out |

### Key Features Working

1. **Auto-commit on save** with configurable delay and file pattern matching
2. **Auto-push** (onCommit, afterDelay, off) with force push modes
3. **Auto-pull** (onPush, afterDelay, off) with pull-on-open
4. **Commit validation** - blocks commits when files have errors/warnings
5. **Branch exclusion** - skip auto-commits on specified branches
6. **Squash/Undo/Restore** version management via Timeline context menu
7. **AI commit messages** from Claude, OpenAI, or Copilot
8. **Secure API key storage** via VS Code SecretStorage API
9. **Status bar** with live sync status
10. **19 configurable settings** exposed in VS Code Settings UI
