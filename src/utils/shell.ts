import * as vscode from "vscode";
import { userInfo } from "os";

const SHELL_PATHS = {
  POWERSHELL_7: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  POWERSHELL_LEGACY: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  CMD: "C:\\Windows\\System32\\cmd.exe",
  WSL_BASH: "/bin/bash",
  MAC_DEFAULT: "/bin/zsh",
  LINUX_DEFAULT: "/bin/bash",
  FALLBACK: "/bin/sh"
} as const;

interface WindowsTerminalProfile {
  path?: string;
  source?: "PowerShell" | "WSL";
}

type WindowsTerminalProfiles = Record<string, WindowsTerminalProfile>;

// Get VS Code default terminal profile
function getVSCodeTerminalConfig() {
  try {
    const config = vscode.workspace.getConfiguration("terminal.integrated");
    const defaultProfileName = config.get<string>("defaultProfile.windows");
    const profiles = config.get<WindowsTerminalProfiles>("profiles.windows");

    if (!profiles) {
      return { defaultProfileName: null, profiles: {} };
    }

    return { defaultProfileName, profiles };
  } catch (error) {
    return { defaultProfileName: null, profiles: {} };
  }
}

export function getShell(): string {

  // Windows shell detection attempts to use the VS Code default terminal profile
  // This will match the shell in the terminal created by Cline
  if (process.platform === "win32") {
    const { defaultProfileName, profiles } = getVSCodeTerminalConfig();
    const profile = defaultProfileName ? profiles[defaultProfileName] : undefined;

    // Check for PowerShell
    if (defaultProfileName?.toLowerCase().includes("powershell")) {
      if (profile?.path) {
        // Use explicit path to powershell if provided, giving Cline the best information we can
        return profile.path;
      } else if (profile?.source === "PowerShell") {
        return SHELL_PATHS.POWERSHELL_7;
      }
      return SHELL_PATHS.POWERSHELL_LEGACY;
    }

    // Check for Windows Subsystem for Linux (WSL)
    if (profile?.source === "WSL" || defaultProfileName?.toLowerCase().includes("wsl")) {
      return SHELL_PATHS.WSL_BASH;
    }

    return SHELL_PATHS.CMD;
  }

  const { env } = process;

  // All other OSes - For now we will use the existing logic that was in place
  // May want to explore the VS Code load method or other user configurable
  // metohods for these in the future
  try {
    const { shell } = userInfo();
    if (shell) {
      return shell;
    }
  } catch (error) {
    console.warn("Failed to get user shell info:", error);
    // Continue to fallback options
  }

  if (process.platform === "darwin") {
    return env.SHELL || SHELL_PATHS.MAC_DEFAULT;
  }

  if (process.platform === "linux") {
    return env.SHELL || SHELL_PATHS.LINUX_DEFAULT;
  }

  // Default to sh if we can't find anything else
  return env.SHELL || SHELL_PATHS.FALLBACK;
}
