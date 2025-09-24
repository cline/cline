### Description

This PR enhances the terminal telemetry system by adding shell information tracking to all terminal execution events. The implementation captures which shell (bash, zsh, PowerShell, cmd, etc.) is being used when terminal commands are executed, providing valuable insights into shell-specific compatibility and usage patterns.

The changes leverage Cline's existing terminal management infrastructure, specifically the `shellPath` property already tracked in `TerminalInfo` objects, and pass this information through to telemetry events.

### Test Procedure

1. **Test on macOS/Linux with different shells:**
   - Open Cline with default shell (zsh/bash)
   - Execute a terminal command through Cline
   - Verify telemetry includes correct shell name
   - Switch terminal profile to a different shell
   - Execute another command and verify new shell is tracked

2. **Test on Windows with different shells:**
   - Test with PowerShell 7 (pwsh.exe)
   - Test with Windows PowerShell (powershell.exe)
   - Test with Command Prompt (cmd.exe)
   - Test with Git Bash if available
   - Verify each shell is correctly identified in telemetry

3. **Test fallback scenarios:**
   - Test with terminals that don't have shell integration
   - Test with unknown/custom shells
   - Verify "unknown" is reported when shell cannot be detected

4. **Verify backward compatibility:**
   - Ensure existing telemetry calls still work
   - Verify optional shell parameter doesn't break existing code

### Type of Change

<!-- Put an 'x' in all boxes that apply -->

-   [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
-   [x] ✨ New feature (non-breaking change which adds functionality)
-   [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
-   [ ] ♻️ Refactor Changes
-   [ ] 💅 Cosmetic Changes
-   [ ] 📚 Documentation update
-   [ ] 🏃 Workflow Changes

### Pre-flight Checklist

<!-- Put an 'x' in all boxes that apply -->

-   [x] Changes are limited to a single feature, bugfix or chore (split larger changes into separate PRs)
-   [ ] Tests are passing (`npm test`) and code is formatted and linted (`npm run format && npm run lint`)
-   [ ] I have created a changeset using `npm run changeset` (required for user-facing changes)
-   [ ] I have reviewed [contributor guidelines](https://github.com/cline/cline/blob/main/CONTRIBUTING.md)

### Screenshots

N/A - This is a telemetry enhancement that doesn't affect the UI. The changes are internal and will be visible in telemetry dashboards.

### Additional Notes

<!-- Add any additional notes for reviewers -->

**Implementation Details:**

1. **TelemetryService.ts**: Added optional `shell?: string` parameter to three terminal telemetry methods:
   - `captureTerminalExecution()`
   - `captureTerminalOutputFailure()`
   - `captureTerminalUserIntervention()`

2. **TerminalProcess.ts**: 
   - Added `shellPath` property and `setShellPath()` method
   - Implemented `extractShellName()` to normalize shell names (e.g., "pwsh" → "powershell-7")
   - Updated all telemetry calls to include the extracted shell name

3. **TerminalManager.ts**: 
   - Modified `runCommand()` to pass `terminalInfo.shellPath` to the TerminalProcess

**Shell Detection Strategy:**
- Uses the `shellPath` already tracked in `TerminalInfo` when terminals are created
- Normalizes common shell variations for consistent telemetry (e.g., pwsh.exe → powershell-7)
- Falls back to "unknown" when shell cannot be determined
- Handles both Unix-style paths (/bin/bash) and Windows paths (C:\Windows\System32\cmd.exe)

**Benefits:**
- Provides insights into which shells are most commonly used with Cline
- Helps identify shell-specific issues and compatibility problems
- Enables data-driven decisions about shell support priorities
- Assists in debugging terminal execution failures by correlating with shell type

**Backward Compatibility:**
- All shell parameters are optional, ensuring existing code continues to work
- No breaking changes to public APIs
- Graceful fallback to "unknown" for missing shell information
