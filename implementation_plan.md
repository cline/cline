 # Implementation Plan: Cline CLI Documentation Update

[Overview]
Update the Cline CLI documentation to reflect the new CLI 2.0 architecture that removes instances, adds a rich TUI experience, and introduces streamlined authentication options.

The Cline CLI 2.0 has undergone significant changes. The previous architecture used explicit instance management (`cline instance new`, `cline instance list`, etc.) which has been completely removed. The new architecture simplifies the user experience:

1. **TUI Mode**: Running `cline` without arguments launches a full-featured terminal UI built with React Ink, featuring an animated robot, file mentions (@), slash commands (/), session summaries, and inline settings panels. This provides a "Claude Code-like" experience.

2. **CLI Mode**: Running `cline "prompt"` executes tasks directly. With `--yolo` flag, it runs non-interactively with output to stdout, making it ideal for CI/CD, piping, and bash scripts.

3. **Authentication**: Multiple options including Cline account OAuth, ChatGPT subscription OAuth (via Codex), import from existing CLI tools (Codex CLI, OpenCode), and BYO API keys. Supports all providers from the VS Code extension (superset).

The documentation must clearly separate these two user journeys (TUI interactive vs CLI automation) while documenting deprecated features for users migrating from older versions.

**Note:** The CLI is now generally available (no longer preview) and supports macOS, Linux, and Windows.

[Types]
No code type changes required - this is a documentation-only update.

This implementation plan only covers documentation files (`.mdx` files in `docs/cline-cli/`). No TypeScript interfaces, types, or code modifications are needed.

[Files]
Update existing files and create new documentation pages for comprehensive coverage.

**Files to UPDATE (in-place):**
- `docs/cline-cli/overview.mdx` - Remove instance references, reframe around TUI vs CLI modes
- `docs/cline-cli/installation.mdx` - Expand with prerequisites, post-install steps, authentication
- `docs/cline-cli/three-core-flows.mdx` - Complete rewrite to remove instances, replace with TUI/CLI/Automation flows
- `docs/cline-cli/cli-reference.mdx` - Replace outdated man page content with current man page from `cli/man/cline.1.md`

**Files to CREATE:**
- `docs/cline-cli/tui-guide.mdx` - New comprehensive guide for the TUI experience
- `docs/cline-cli/authentication.mdx` - New guide covering all auth options
- `docs/cline-cli/configuration.mdx` - New guide for `cline config` and settings management

**Files to MODIFY:**
- `docs/docs.json` - Add new pages to navigation under CLI group

[Functions]
No function changes required - documentation only.

This is a documentation update with no code changes to functions, methods, or handlers.

[Classes]
No class changes required - documentation only.

This is a documentation update with no code changes to classes or components.

[Dependencies]
No dependency changes required.

This is a documentation update with no package changes.

[Testing]
Documentation should be verified for accuracy by cross-referencing with source code.

**Verification steps:**
1. Cross-reference all documented features against `cli/src/index.ts` entry point
2. Verify keyboard shortcuts against `cli/src/components/ChatView.tsx`
3. Verify auth options against `cli/src/components/AuthView.tsx`
4. Verify slash commands against `cli/src/components/HelpPanelContent.tsx`
5. Verify config options against `cli/src/components/ConfigView.tsx` and `SettingsPanelContent.tsx`
6. Verify import sources against `cli/src/utils/import-configs.ts`
7. Run `npm run docs:dev` (if available) to preview documentation locally

**Content accuracy checks:**
- [ ] All keyboard shortcuts match source code
- [ ] All command flags match `cli/src/index.ts`
- [ ] Auth provider list matches `AuthView.tsx`
- [ ] Import sources correctly documented (Codex CLI, OpenCode - NOT "Claude Code")
- [ ] Deprecated features clearly marked

[Implementation Order]
Execute documentation updates in dependency order to ensure consistency.

1. **Update `docs/docs.json`** - Add new page entries to navigation first so links work
2. **Create `docs/cline-cli/authentication.mdx`** - Auth is foundational, other docs reference it
3. **Create `docs/cline-cli/tui-guide.mdx`** - Core new content for TUI users
4. **Create `docs/cline-cli/configuration.mdx`** - Config management guide
5. **Update `docs/cline-cli/overview.mdx`** - Reframe overview with new architecture
6. **Update `docs/cline-cli/installation.mdx`** - Expand installation guide
7. **Update `docs/cline-cli/three-core-flows.mdx`** - Rewrite as TUI/CLI/Automation flows
8. **Update `docs/cline-cli/cli-reference.mdx`** - Replace with current man page content
9. **Verify all cross-references and links work correctly**

---

## Detailed File Specifications

### 1. `docs/docs.json` (UPDATE)

Add new pages to the CLI navigation group:

```json
{
  "group": "CLI",
  "pages": [
    "cline-cli/overview",
    "cline-cli/installation",
    "cline-cli/authentication",
    "cline-cli/tui-guide",
    "cline-cli/configuration",
    "cline-cli/three-core-flows",
    {
      "group": "CLI Samples",
      "pages": [
        "cline-cli/samples/overview",
        "cline-cli/samples/github-issue-rca",
        "cline-cli/samples/github-integration"
      ]
    },
    "cline-cli/cli-reference"
  ]
}
```

### 2. `docs/cline-cli/authentication.mdx` (CREATE)

**Purpose:** Comprehensive guide to all authentication options

**Sections:**
- Quick start (sign in with Cline - recommended)
- Sign in with ChatGPT subscription (OpenAI Codex OAuth)
- Import from existing CLI tools:
  - Import from Codex CLI (`~/.codex/auth.json`)
  - Import from OpenCode (`~/.local/share/opencode/auth.json`)
- Bring your own API keys (manual provider configuration)
- Supported providers list with examples
- Switching providers (`cline auth`)
- Quick setup flags (`cline auth -p <provider> -k <key> -m <model>`)

**Key corrections from user input:**
- User said "import from Claude Code" - INCORRECT. Actual sources are:
  - Codex CLI (OpenAI's CLI tool)
  - OpenCode
- Document the actual import sources from `cli/src/utils/import-configs.ts`

### 3. `docs/cline-cli/tui-guide.mdx` (CREATE)

**Purpose:** Guide to the interactive terminal UI experience

**Sections:**
- Launching the TUI (`cline` without arguments)
- The welcome screen and robot animation
- Input field and message display
- Keyboard shortcuts:
  - `Tab` - Toggle Plan/Act mode
  - `Shift+Tab` - Toggle auto-approve all
  - `Enter` - Submit message
  - `Esc` - Exit/cancel
  - `↑/↓` - Navigate history
  - `Home/End` - Cursor movement
  - `Ctrl+A/E/W/U` - Text editing
- File mentions with `@`:
  - Type `@` to search workspace files
  - Uses ripgrep for fast searching
- Slash commands with `/`:
  - `/settings` - Open settings panel
  - `/models` - Quick model switching
  - `/history` - Browse task history
  - `/clear` - Start fresh task
  - `/help` - Show help
  - `/exit` - Exit CLI
  - Workflow commands
- Settings panel (`/settings`):
  - API tab (provider, model, thinking)
  - Auto-approve tab
  - Features tab
  - Account tab
  - Other tab
- Session summary on exit
- Running multiple instances with `--config`:
  - Default: settings shared across all instances
  - Use `cline --config /path/to/config` for isolated configs
  - Recommend tmux/terminal multiplexing for parallel work

### 4. `docs/cline-cli/configuration.mdx` (CREATE)

**Purpose:** Guide to `cline config` command and settings management

**Sections:**
- Running `cline config`
- Configuration tabs:
  - Settings (global state, workspace state)
  - Rules (`.clinerules` files, Cursor rules, Windsurf rules)
  - Workflows
  - Hooks (if enabled)
  - Skills (if enabled)
- Keyboard navigation in config view
- Editing configuration values
- Configuration directory structure (`~/.cline/data/`)
- Environment variables (`CLINE_DIR`, `CLINE_COMMAND_PERMISSIONS`)
- Using `--config` flag for separate configurations

### 5. `docs/cline-cli/overview.mdx` (UPDATE)

**Changes:**
- Remove all references to instances (`cline instance new/list/kill`)
- Reframe around two modes: TUI (interactive) and CLI (automation)
- Update "What you can build" section to remove multi-instance examples
- Add section about new TUI features
- Link to new authentication and TUI guide pages
- Note deprecation of instance commands

**New structure:**
1. What is Cline CLI?
2. Two ways to use Cline CLI:
   - TUI Mode (interactive development)
   - CLI Mode (automation and scripting)
3. Supported Model Providers
4. What you can build
5. Learn more (links)

### 6. `docs/cline-cli/installation.mdx` (UPDATE)

**Changes:**
- Remove "Preview Release - macOS and Linux Only" warning (CLI is now GA and supports Windows)
- Add note that CLI supports macOS, Linux, and Windows
- Add Node.js version requirement (20+, recommend 22)
- Add version specification (`npm install -g cline@2.0.0`)
- Add more detail on post-install authentication
- Link to new authentication guide
- Add troubleshooting tips
- Add verification steps

**New structure:**
1. Prerequisites (Node.js version)
2. Installation: `npm install -g cline` (or `npm install -g cline@2.0.0`)
3. Authentication (`cline auth` - link to auth guide)
4. Quick Start (two paths: TUI and CLI)
5. Next Steps (links to guides)

### 7. `docs/cline-cli/three-core-flows.mdx` (UPDATE - Major Rewrite)

**Complete rewrite removing all instance references.**

**New title suggestion:** "CLI Workflows" or "Getting Started Workflows"

**New structure:**
1. **Interactive TUI Mode** (replaces old "Interactive mode")
   - Launch with `cline`
   - Plan/Act mode toggle (Tab key)
   - Using slash commands and file mentions
   - Auto-approve toggle (Shift+Tab)
   - Session summary on exit (Ctrl+C)
2. **Direct Task Execution** (replaces old "Headless single-shot")
   - `cline "prompt"` syntax
   - Piping context (`cat file | cline "explain"`)
   - Piping cline into cline: `git diff | cline -y "explain" | cline -y "write poem"`
   - Image attachments
3. **Automation & CI/CD** (replaces old "Multi-instance")
   - `--yolo` / `-y` flag for non-interactive mode (also called "yes mode")
   - `--json` output for parsing (same format as `~/.cline/data/tasks/<id>/ui_messages.json`)
   - `--timeout` for long-running tasks
   - Environment variables:
     - `CLINE_DIR` - custom config directory
     - `CLINE_COMMAND_PERMISSIONS` - restrict allowed shell commands
   - Example GitHub Actions workflow for PR review

**Creative use cases from engineer demo:**
- Chain cline commands: `git diff | cline -y "explain" | cline -y "write a poem about this"`
- GitHub PR review workflow with `gh` CLI integration

**Deprecation notice:**
Add a callout at the top noting that instance commands (`cline instance new/list/kill`) have been removed in favor of the simpler architecture.

### 8. `docs/cline-cli/cli-reference.mdx` (UPDATE)

**Changes:**
- Replace the outdated embedded man page with content from `cli/man/cline.1.md`
- The current man page in the docs references old instance commands
- The actual man page (`cli/man/cline.1.md`) has correct, updated content
- Convert man page markdown format to mdx documentation format
- Add JSON output schema section
- Add environment variables section
- Remove all instance command references

---

---

## Additional Features from Engineer Demo

### Man Page
- `man cline` - View in-depth documentation in terminal

### Dev Tools
- `cline dev log` - Opens log file for debugging
- `cline update` - Check for and install updates

### JSON Output Format
- Same format as saved task files: `~/.cline/data/tasks/<id>/ui_messages.json`
- Useful for programmatic use cases
- Pipe through `jq` for easier parsing
- Example: `cline --json "prompt" | jq '.text'`

---

## Verification Checklist

After implementation, verify these user requirements are documented:

- [x] New TUI experience explained
- [x] NPM installation covered
- [x] Authorization options:
  - [x] Sign in with Cline
  - [x] Sign in with ChatGPT Subscription (Codex OAuth)
  - [x] Import from Codex CLI (CORRECTED from "Claude Code")
  - [x] Import from OpenCode
  - [x] Bring your own API keys
  - [x] Bedrock support mentioned
- [x] `cline auth` for changing providers
- [x] Basic CLI usage:
  - [x] `cline "task"` syntax
  - [x] Piping context
  - [x] `--yolo` / `-y` for CI/CD (also called "yes mode")
- [x] TUI features:
  - [x] `cline` alone launches TUI
  - [x] Tab to toggle Plan/Act mode
  - [x] Shift+Tab for auto-approve all
  - [x] Session summary on exit (Ctrl+C)
  - [x] `--config` for separate configs
- [x] Instance deprecation noted
- [x] `cline config` for rules, workflows, hooks, skills
- [x] @ file mentions with autocomplete (fuzzy search)
- [x] / slash commands with autocomplete
  - [x] `/settings` documented
  - [x] `/models` documented
  - [x] `/history` documented
  - [x] Workflows generate slash commands
- [x] /settings panel sections documented (arrow keys to navigate tabs)
- [x] Environment variables:
  - [x] `CLINE_DIR` documented
  - [x] `CLINE_COMMAND_PERMISSIONS` documented (security measure)
- [x] Dev tools:
  - [x] `cline dev log` documented
  - [x] `cline update` documented
  - [x] `man cline` documented
- [x] JSON output format documented
- [x] Piping cline into cline documented
- [x] GitHub Actions PR review example included
