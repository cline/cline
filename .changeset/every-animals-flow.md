---
"claude-dev": patch
---

# Terminal Profile Environment Variables Fix

## Issue

When Cline's "Default Terminal Profile" setting was set to "Default", environment variables defined in VS Code's custom terminal profiles were not being passed to Cline's terminal sessions.

## GitHub Issue: #7793

## Root Cause

Three issues in the codebase:
shell.ts: Profile interfaces were missing the env property, so environment variables were never read from VS Code's configuration.
TerminalRegistry.ts: The createTerminal() method only set CLINE_ACTIVE as an environment variable and didn't accept profile env vars.
TerminalManager.ts: When profile was "default", the code set expectedShellConfig to undefined, skipping the env var extraction entirely.

## Changes Made

1. shell.ts
   Added env?: Record<string, string> to WindowsTerminalProfile, MacTerminalProfile, and LinuxTerminalProfile interfaces
   Created TerminalProfileConfig interface with path and env properties
   Modified getShell() to return TerminalProfileConfig instead of just a string
   Modified getShellForProfile() to return TerminalProfileConfig
   Updated getWindowsShellFromVSCode(), getMacShellFromVSCode(), and getLinuxShellFromVSCode() to return TerminalProfileConfig with env vars

2. TerminalRegistry.ts
   Added profileEnv?: Record<string, string> parameter to createTerminal()
   Merged profile env vars with CLINE_ACTIVE when creating terminal options

3. TerminalManager.ts
   Changed expectedShellConfig to always call getShellForProfile() instead of returning undefined when profile is "default"
   Updated createTerminal() calls to pass expectedShellConfig.env

## Testing

Add a custom terminal profile in VS Code settings with env vars
Set that profile as default in VS Code
Set Cline's "Default Terminal Profile" to "Default"
Ask Cline to run echo $MY_VAR
Verify the env var is correctly set

## Files Changed

1. shell.ts
2. TerminalRegistry.ts
3. TerminalManager.ts