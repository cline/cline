# Installing Development Version of Cline in VS Code

This guide explains how to install and test the development version of Cline with the new hook system in your VS Code.

## Prerequisites

- VS Code installed
- Node.js 18+ and npm installed
- Git installed

## Installation Steps

### 1. Build the Extension

First, navigate to the Cline directory and install dependencies:

```bash
cd /Users/griever/Developer/cline

# Install all dependencies
npm run install:all
```

### 2. Compile the Extension

Build the extension with the hook system:

```bash
# Build the webview UI first
npm run build:webview

# Package the extension
npm run package
```

This creates a `.vsix` file in the project directory.

### 3. Install in VS Code

#### Option A: Command Line Installation

```bash
# Find the generated .vsix file
ls -la *.vsix

# Install using VS Code CLI
code --install-extension claude-dev-*.vsix
```

#### Option B: GUI Installation

1. Open VS Code
2. Go to Extensions view (⇧⌘X)
3. Click the "..." menu at the top of Extensions sidebar
4. Select "Install from VSIX..."
5. Navigate to `/Users/griever/Developer/cline`
6. Select the `claude-dev-*.vsix` file
7. Click "Install"

### 4. Reload VS Code

After installation, reload VS Code:
- Press `⌘R` (Mac) in VS Code
- Or use Command Palette: "Developer: Reload Window"

## Verification

### 1. Check Extension is Installed

1. Open Extensions view (⇧⌘X)
2. Search for "Cline"
3. You should see "Cline (Claude Dev)" installed
4. Version should show as development version

### 2. Test Basic Functionality

1. Open Command Palette (⇧⌘P)
2. Type "Cline" to see available commands
3. Select "Cline: Open In New Tab" or click Cline icon in activity bar

### 3. Test Hook System

#### Quick Test
```bash
# In your project directory
cd /Users/griever/Developer/cline

# Run hook tests
node test-hooks/test-hook-events.js
```

#### Live Test with Cline

1. Ensure test hooks are configured:
```bash
# Check hook configuration exists
cat .cline/settings.json
```

2. Start a new Cline task:
   - Open Cline (⇧⌘P → "Cline: Open")
   - Enter a simple task like "Create a hello.txt file"

3. Monitor hook execution:
```bash
# Watch the log file
tail -f /tmp/cline-hook-test.log
```

You should see events being logged as Cline executes tools.

## Development Workflow

### Making Changes

1. Make your code changes
2. Rebuild:
```bash
npm run compile
```
3. Reload VS Code (⌘R)

### Running in Debug Mode

1. Open Cline project in VS Code
2. Press F5 to launch Extension Development Host
3. A new VS Code window opens with the extension loaded
4. Test your changes in this window
5. Set breakpoints in the original window for debugging

### Watching for Changes

For active development:
```bash
# Terminal 1: Watch TypeScript
npm run watch:tsc

# Terminal 2: Watch esbuild
npm run watch:esbuild

# Terminal 3: Watch webview (if making UI changes)
npm run dev:webview
```

## Troubleshooting

### Extension Not Loading

1. Check for errors in Output panel:
   - View → Output
   - Select "Extension Host" from dropdown

2. Check extension is enabled:
   - Extensions → Cline → Make sure it's enabled

### Build Errors

```bash
# Clean and rebuild
npm run clean:all
npm run install:all
npm run package
```

### Hook System Not Working

1. Verify hook configuration:
```bash
cat .cline/settings.json
```

2. Check hook script is executable:
```bash
chmod +x test-hooks/simple-logger.js
```

3. Test hook directly:
```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"path":"test.txt"}}' | node test-hooks/simple-logger.js
```

### Conflicts with Production Cline

If you have the marketplace version installed:

1. Disable marketplace version:
   - Extensions → Cline (marketplace) → Disable

2. Or uninstall marketplace version:
   ```bash
   code --uninstall-extension saoudrizwan.claude-dev
   ```

## Testing Checklist

- [ ] Extension installs without errors
- [ ] Cline opens and accepts tasks
- [ ] Tools execute correctly
- [ ] Hooks fire for PreToolUse events
- [ ] Hooks fire for PostToolUse events
- [ ] Hooks fire for UserPromptSubmit
- [ ] Hooks fire for SessionStart/End
- [ ] Hook logs are created in `/tmp/cline-hook-test.log`

## Uninstalling Development Version

To remove the development version:

```bash
# List installed extensions
code --list-extensions

# Uninstall
code --uninstall-extension saoudrizwan.claude-dev
```

Or through VS Code:
1. Extensions view (⇧⌘X)
2. Find Cline
3. Click Uninstall

## Next Steps

Once installed and tested:

1. **Configure Production Hooks**: Replace test hooks with actual monitoring
2. **Test with agent-manager**: Configure to use agent-manager hooks
3. **Performance Testing**: Validate hook overhead
4. **Integration Testing**: Test with full monitoring stack

## Support

If you encounter issues:
1. Check the Output panel for errors
2. Review `/tmp/cline-hook-test.log` for hook issues
3. Check GitHub issues for known problems
4. File a bug report with logs and reproduction steps