# Terminal Setup Guide: Shift+Enter for Newlines

This guide explains how to configure shift+enter to insert newlines in different terminals when using the Cline CLI.

## Why This Is Needed

By default, most terminals treat shift+enter the same as regular enter. To use shift+enter for newlines (and regular enter to submit), you need to configure your terminal to send a special escape sequence.

## Terminal-Specific Configuration

### Ghostty ✅ (Automatic + Manual)

**Automatic**: The CLI now detects Ghostty's `[27;2;13~` sequence automatically!

**Manual Config** (optional, for better reliability):

Add to `~/.config/ghostty/config`:
```
keybind = shift+enter=text:\u001b\n
```

Then restart Ghostty.

### Terminal.app 🛠️ (Manual Configuration Required)

Terminal.app doesn't support keyboard protocols, so you must configure it manually:

1. Open Terminal.app
2. Go to **Preferences** (Cmd+,)
3. Select your profile under **Profiles**
4. Click the **Keyboard** tab
5. Click the **+** button at the bottom
6. When prompted, press **shift+enter**
7. Set:
   - **Action**: "Send Text"
   - **Text**: `\033\n` (this is ESC followed by newline)
8. Click **OK**

Now shift+enter will work!

### VS Code / Cursor Terminal ✅ (Automatic)

**The CLI automatically configures this for you!**

On first run, the CLI will add the shift+enter keybinding to:
- **VS Code**: `~/Library/Application Support/Code/User/keybindings.json`
- **Cursor**: `~/Library/Application Support/Cursor/User/keybindings.json`

A backup is created before any modifications.

**Manual setup (if needed):**

1. Press **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P** (Windows/Linux)
2. Type "Preferences: Open Keyboard Shortcuts (JSON)"
3. Add this binding:

```json
{
    "key": "shift+enter",
    "command": "workbench.action.terminal.sendSequence",
    "args": {
        "text": "\u001b\n"
    },
    "when": "terminalFocus"
}
```

4. Save and reload (Cmd+Shift+P → "Developer: Reload Window")

### iTerm2 ✅ (Works by Default)

iTerm2 maps shift+enter to alt+enter by default, so it works without any configuration!

### WezTerm 🛠️ (Manual Configuration)

Add to `~/.wezterm.lua`:

```lua
local wezterm = require 'wezterm'
local config = {}

config.keys = {
  {
    key = 'Enter',
    mods = 'SHIFT',
    action = wezterm.action.SendString '\x1b\n',
  },
}

return config
```

### Alacritty 🛠️ (Manual Configuration)

Add to `~/.config/alacritty/alacritty.yml`:

```yaml
key_bindings:
  - { key: Return, mods: Shift, chars: "\x1b\n" }
```

### Kitty 🛠️ (Manual Configuration)

Add to `~/.config/kitty/kitty.conf`:

```
map shift+enter send_text all \x1b\n
```

## How It Works

The CLI uses three methods to detect shift+enter:

1. **Bubbletea's native "shift+enter" detection** (works with configured terminals)
2. **Alt+enter fallback** (works with iTerm2 by default)
3. **Ghostty sequence detection** (automatically detects `[27;2;13~`)
4. **Ctrl+J** (traditional Unix newline shortcut)

## Testing

After configuration, test in your terminal:

```bash
./cline
# or
cline
```

Try pressing:
- **shift+enter** → should insert a newline
- **enter** → should submit the message
- **alt+enter** → should also insert a newline (fallback)
- **ctrl+j** → should also insert a newline (fallback)

## Troubleshooting

### Shift+Enter Still Submits Instead of New Line

1. **Check your terminal config** - Make sure you followed the steps above
2. **Restart your terminal** - Some terminals require a restart
3. **Try alt+enter or ctrl+j** - These should work as fallbacks
4. **Check for conflicts** - Other tools/shells might override keybindings

### Sequence Appears as Text (e.g., `[27;2;13~`)

This means:
- Your terminal is sending the sequence correctly
- But the CLI isn't parsing it

Please file a bug report with:
- Terminal name and version
- The exact text that appears
- Output of: `echo $TERM`

## Why Not Just Use Enter for Newlines?

The CLI follows the common pattern where:
- **Enter** = Submit (like sending a chat message)
- **Shift+Enter** = Newline (like composing multi-line input)

This matches the behavior of:
- Slack, Discord, Teams
- Claude.ai web interface
- Most chat applications
- Many IDE terminals

## Alternative: Use External Editor

Don't want to configure your terminal? Press **ctrl+e** to open your $EDITOR for composing multi-line messages!
