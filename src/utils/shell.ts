import * as vscode from 'vscode';

let defaultShellCache: string | undefined;

export async function getShell(): Promise<string> {
  if (defaultShellCache) {
    return defaultShellCache;
  }

  // Windows
  if (process.platform === 'win32') {
    const config = vscode.workspace.getConfiguration('terminal.integrated');
    const defaultProfileName = config.get<string>('defaultProfile.windows');
    const profiles = config.get<Record<string, any>>('profiles.windows');
    const profile = defaultProfileName ? profiles?.[defaultProfileName] : undefined;

    // Check for PowerShell
    if (defaultProfileName?.toLowerCase().includes('powershell')) {
      if (profile?.path) {
        // Use explicit path to powershell if provided, giving Cline the best information we can
        return profile.path;
      } else if (profile?.source === 'PowerShell') {
        // If source = PowerShell and no path is provided, this is indicitive of a non-standard PowerShell installation - Likely PowerShell CORE 6.x or 7.x. Both use the same syntax.
        return 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      }
      // Assume default Windows PowerShell (OS default as of Jan 2025)
      return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    }

    // Check for Windows Subsystem for Linux (WSL)
    if (profile?.source === 'WSL' || defaultProfileName?.toLowerCase().includes('wsl')) {
      return '/bin/bash';
    }
  }
  const { default: defaultShell } = await import('default-shell');
  defaultShellCache = defaultShell;
  return defaultShell; // If macOS or Linux, use old default-shell method
}
