import { existsSync } from "fs"
import { userInfo } from "os"
import * as vscode from "vscode"

export const WINDOWS_POWERSHELL_7_PATH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
export const WINDOWS_POWERSHELL_LEGACY_PATH = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
// WSL Bash is reached through the wsl.exe launcher, not the guest-side /bin/bash
// path (which does not exist on the Windows host). wsl.exe runs the command in
// the default distro and translates the Windows working directory to its
// /mnt/<drive> mount automatically. getShellArgs() appends the `bash -c` form.
export const WINDOWS_WSL_PATH = "C:\\Windows\\System32\\wsl.exe"

const SHELL_PATHS = {
	// Windows paths
	POWERSHELL_7: WINDOWS_POWERSHELL_7_PATH,
	POWERSHELL_LEGACY: WINDOWS_POWERSHELL_LEGACY_PATH,
	CMD: "C:\\Windows\\System32\\cmd.exe",
	WSL_BASH: WINDOWS_WSL_PATH,
	GIT_BASH: "C:\\Program Files\\Git\\bin\\bash.exe",
	// Unix paths
	MAC_DEFAULT: "/bin/zsh",
	LINUX_DEFAULT: "/bin/bash",
	CSH: "/bin/csh",
	BASH: "/bin/bash",
	KSH: "/bin/ksh",
	SH: "/bin/sh",
	ZSH: "/bin/zsh",
	DASH: "/bin/dash",
	TCSH: "/bin/tcsh",
	FALLBACK: "/bin/sh",
} as const

interface MacTerminalProfile {
	path?: string
}

type MacTerminalProfiles = Record<string, MacTerminalProfile>

interface WindowsTerminalProfile {
	path?: string
	source?: "PowerShell" | "WSL"
}

type WindowsTerminalProfiles = Record<string, WindowsTerminalProfile>

interface LinuxTerminalProfile {
	path?: string
}

type LinuxTerminalProfiles = Record<string, LinuxTerminalProfile>

// -----------------------------------------------------
// 1) VS Code Terminal Configuration Helpers
// -----------------------------------------------------

function getWindowsTerminalConfig() {
	try {
		const config = vscode.workspace.getConfiguration("terminal.integrated")
		const defaultProfileName = config.get<string>("defaultProfile.windows")
		const profiles = config.get<WindowsTerminalProfiles>("profiles.windows") || {}
		return { defaultProfileName, profiles }
	} catch {
		return { defaultProfileName: null, profiles: {} as WindowsTerminalProfiles }
	}
}

function getMacTerminalConfig() {
	try {
		const config = vscode.workspace.getConfiguration("terminal.integrated")
		const defaultProfileName = config.get<string>("defaultProfile.osx")
		const profiles = config.get<MacTerminalProfiles>("profiles.osx") || {}
		return { defaultProfileName, profiles }
	} catch {
		return { defaultProfileName: null, profiles: {} as MacTerminalProfiles }
	}
}

function getLinuxTerminalConfig() {
	try {
		const config = vscode.workspace.getConfiguration("terminal.integrated")
		const defaultProfileName = config.get<string>("defaultProfile.linux")
		const profiles = config.get<LinuxTerminalProfiles>("profiles.linux") || {}
		return { defaultProfileName, profiles }
	} catch {
		return { defaultProfileName: null, profiles: {} as LinuxTerminalProfiles }
	}
}

// -----------------------------------------------------
// 2) Platform-Specific VS Code Shell Retrieval
// -----------------------------------------------------

/** Attempts to retrieve a shell path from VS Code config on Windows. */
function getWindowsShellFromVSCode(): string | null {
	const { defaultProfileName, profiles } = getWindowsTerminalConfig()
	if (!defaultProfileName) {
		return null
	}

	const profile = profiles[defaultProfileName]

	// If the profile name indicates PowerShell, do version-based detection.
	// In testing it was found these typically do not have a path, and this
	// implementation manages to deductively get the correct version of PowerShell
	if (defaultProfileName.toLowerCase().includes("powershell")) {
		if (profile?.path) {
			// If there's an explicit PowerShell path, return that
			return profile.path
		}
		if (profile?.source === "PowerShell") {
			// If the profile is sourced from PowerShell, assume the newest
			return SHELL_PATHS.POWERSHELL_7
		}
		// Otherwise, assume legacy Windows PowerShell
		return SHELL_PATHS.POWERSHELL_LEGACY
	}

	// If there's a specific path, return that immediately
	if (profile?.path) {
		return profile.path
	}

	// If the profile indicates WSL
	if (profile?.source === "WSL" || defaultProfileName.toLowerCase().includes("wsl")) {
		return SHELL_PATHS.WSL_BASH
	}

	// If nothing special detected, we assume cmd
	return SHELL_PATHS.CMD
}

/** Attempts to retrieve a shell path from VS Code config on macOS. */
function getMacShellFromVSCode(): string | null {
	const { defaultProfileName, profiles } = getMacTerminalConfig()
	if (!defaultProfileName) {
		return null
	}

	const profile = profiles[defaultProfileName]
	return profile?.path || null
}

/** Attempts to retrieve a shell path from VS Code config on Linux. */
function getLinuxShellFromVSCode(): string | null {
	const { defaultProfileName, profiles } = getLinuxTerminalConfig()
	if (!defaultProfileName) {
		return null
	}

	const profile = profiles[defaultProfileName]
	return profile?.path || null
}

// -----------------------------------------------------
// 3) General Fallback Helpers
// -----------------------------------------------------

/**
 * Tries to get a user’s shell from os.userInfo() (works on Unix if the
 * underlying system call is supported). Returns null on error or if not found.
 */
function getShellFromUserInfo(): string | null {
	try {
		const { shell } = userInfo()
		return shell || null
	} catch {
		return null
	}
}

/** Returns the environment-based shell variable, or null if not set. */
function getShellFromEnv(): string | null {
	const { env } = process

	if (process.platform === "darwin") {
		// On macOS/Linux, SHELL is commonly the environment variable
		return env.SHELL || "/bin/zsh"
	}

	if (process.platform === "linux") {
		// On Linux, SHELL is commonly the environment variable
		return env.SHELL || "/bin/bash"
	}
	return null
}

// -----------------------------------------------------
// 4) Terminal Profile Interface and Utilities
// -----------------------------------------------------

import { TerminalProfile } from "@shared/proto/cline/state"

/** Gets available terminal profiles for the current platform */
export function getAvailableTerminalProfiles(): TerminalProfile[] {
	const profiles: TerminalProfile[] = [
		{
			id: "default",
			name: "Default",
			description: "Use VSCode's default terminal configuration",
		},
	]

	if (process.platform === "win32") {
		// Windows terminal profiles
		profiles.push(
			{
				id: "powershell-7",
				name: "PowerShell 7",
				path: SHELL_PATHS.POWERSHELL_7,
				description: "PowerShell 7 (pwsh.exe)",
			},
			{
				id: "powershell-legacy",
				name: "Windows PowerShell",
				path: SHELL_PATHS.POWERSHELL_LEGACY,
				description: "Windows PowerShell 5.x",
			},
			{
				id: "cmd",
				name: "Command Prompt",
				path: SHELL_PATHS.CMD,
				description: "Command Prompt (cmd.exe)",
			},
			{
				id: "wsl-bash",
				name: "WSL Bash",
				path: SHELL_PATHS.WSL_BASH,
				description: "Windows Subsystem for Linux Bash",
			},
			{
				id: "git-bash",
				name: "Git Bash",
				path: SHELL_PATHS.GIT_BASH,
				description: "Git Bash (bash.exe from Git for Windows)",
			},
		)
	} else if (process.platform === "darwin") {
		// macOS terminal profiles
		profiles.push(
			{
				id: "zsh",
				name: "zsh",
				path: SHELL_PATHS.ZSH,
				description: "Z shell (default on macOS)",
			},
			{
				id: "bash",
				name: "bash",
				path: SHELL_PATHS.BASH,
				description: "Bourne Again Shell",
			},
		)
	} else if (process.platform === "linux") {
		// Linux terminal profiles
		profiles.push(
			{
				id: "bash",
				name: "bash",
				path: SHELL_PATHS.BASH,
				description: "Bourne Again Shell (default on most Linux)",
			},
			{
				id: "zsh",
				name: "zsh",
				path: SHELL_PATHS.ZSH,
				description: "Z shell",
			},
			{
				id: "dash",
				name: "dash",
				path: SHELL_PATHS.DASH,
				description: "Debian Almquist Shell",
			},
		)
	}

	return profiles
}

/** Gets the shell path for a specific terminal profile */
export function getShellForProfile(profileId: string): string {
	// If it's the default profile, use the existing getShell() logic
	if (profileId === "default") {
		return getShell()
	}

	// Find the profile
	const profiles = getAvailableTerminalProfiles()
	const profile = profiles.find((p) => p.id === profileId)

	if (profile?.path) {
		return profile.path
	}

	// Fallback to default shell if profile not found
	return getShell()
}

// -----------------------------------------------------
// 5) Publicly Exposed Shell Getter
// -----------------------------------------------------

/**
 * Absolute paths where a modern PowerShell (pwsh) may be installed, most
 * preferred first: MSI/ZIP installs under Program Files (either architecture),
 * then the Microsoft Store install under LOCALAPPDATA. This is the single
 * candidate list shared with the async prober in utils/powershell.ts.
 */
export function getWindowsPwshInstallPaths(): string[] {
	const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files"
	const localAppData = process.env.LOCALAPPDATA
	return [
		`${programFiles}\\PowerShell\\7\\pwsh.exe`,
		`${programFiles}\\PowerShell\\6\\pwsh.exe`,
		SHELL_PATHS.POWERSHELL_7,
		...(localAppData ? [`${localAppData}\\Microsoft\\WindowsApps\\pwsh.exe`] : []),
	]
}

/**
 * The shell VS Code launches on Windows when the user has not configured a
 * default terminal profile: its built-in default is PowerShell (pwsh when
 * installed, Windows PowerShell otherwise) — never cmd.exe. Mirroring that
 * here keeps the "default" profile meaning the same shell whether commands
 * run in a visible VS Code terminal or a background child process.
 */
function getWindowsDefaultShell(): string {
	const pwsh = getWindowsPwshInstallPaths().find((candidate) => existsSync(candidate))
	return pwsh ?? SHELL_PATHS.POWERSHELL_LEGACY
}

export function getShell(): string {
	// 1. Check VS Code config first.
	if (process.platform === "win32") {
		// Special logic for Windows
		const windowsShell = getWindowsShellFromVSCode()
		if (windowsShell) {
			return windowsShell
		}
		// No profile configured — match the shell VS Code's default terminal
		// would launch. userInfo()/COMSPEC are not consulted: VS Code's own
		// terminal ignores them too, and they would resolve to cmd.exe.
		return getWindowsDefaultShell()
	}
	if (process.platform === "darwin") {
		// macOS from VS Code
		const macShell = getMacShellFromVSCode()
		if (macShell) {
			return macShell
		}
	} else if (process.platform === "linux") {
		// Linux from VS Code
		const linuxShell = getLinuxShellFromVSCode()
		if (linuxShell) {
			return linuxShell
		}
	}

	// 2. If no shell from VS Code, try userInfo()
	const userInfoShell = getShellFromUserInfo()
	if (userInfoShell) {
		return userInfoShell
	}

	// 3. If still nothing, try environment variable
	const envShell = getShellFromEnv()
	if (envShell) {
		return envShell
	}

	// 4. Fall back to a POSIX shell - This is the behavior of our old shell detection method.
	return SHELL_PATHS.FALLBACK
}
