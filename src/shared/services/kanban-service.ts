import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const LAUNCHD_LABEL = "com.cline.kanban"
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
const CLINE_LOGS_DIR = join(homedir(), ".cline", "logs")

export interface KanbanServiceStatus {
	installed: boolean
	loaded: boolean
	kanbanBinaryPath?: string
}

const assertMacOS = (): void => {
	if (process.platform !== "darwin")
		throw new Error(
			"Kanban auto-start is only supported on macOS. Use launchd on macOS, or configure your system's startup manager manually.",
		)
}

const escapeXml = (str: string): string => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const decodeXml = (str: string): string => str.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")

const buildPlistContent = (kanbanBinaryPath: string, currentPath: string): string =>
	`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LAUNCHD_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${escapeXml(kanbanBinaryPath)}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<false/>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>${escapeXml(currentPath)}</string>
	</dict>
	<key>StandardOutPath</key>
	<string>${escapeXml(join(CLINE_LOGS_DIR, "kanban-launchd.log"))}</string>
	<key>StandardErrorPath</key>
	<string>${escapeXml(join(CLINE_LOGS_DIR, "kanban-launchd-error.log"))}</string>
</dict>
</plist>
`

const isServiceLoaded = async (): Promise<boolean> => {
	try {
		await execFileAsync("launchctl", ["list", LAUNCHD_LABEL])
		return true
	} catch {
		return false
	}
}

export const resolveKanbanBinaryPath = async (): Promise<string> => {
	const { stdout } = await execFileAsync("which", ["kanban"])
	return stdout.trim()
}

export const installKanbanLaunchAgent = async (kanbanBinaryPath: string): Promise<void> => {
	assertMacOS()

	if (await isServiceLoaded()) {
		try {
			await execFileAsync("launchctl", ["unload", PLIST_PATH])
		} catch {
			// May fail if plist was removed but service still in memory
		}
	}

	const launchAgentsDir = join(homedir(), "Library", "LaunchAgents")
	if (!existsSync(launchAgentsDir)) mkdirSync(launchAgentsDir, { recursive: true })
	if (!existsSync(CLINE_LOGS_DIR)) mkdirSync(CLINE_LOGS_DIR, { recursive: true })

	writeFileSync(PLIST_PATH, buildPlistContent(kanbanBinaryPath, process.env.PATH ?? ""), "utf-8")
	await execFileAsync("launchctl", ["load", PLIST_PATH])
}

export const uninstallKanbanLaunchAgent = async (): Promise<void> => {
	assertMacOS()
	if (!existsSync(PLIST_PATH)) return

	if (await isServiceLoaded()) {
		try {
			await execFileAsync("launchctl", ["unload", PLIST_PATH])
		} catch {}
	}

	unlinkSync(PLIST_PATH)
}

export const getKanbanServiceStatus = async (): Promise<KanbanServiceStatus> => {
	assertMacOS()

	const installed = existsSync(PLIST_PATH)
	let loaded = false
	let kanbanBinaryPath: string | undefined

	if (installed) {
		loaded = await isServiceLoaded()
		try {
			const content = readFileSync(PLIST_PATH, "utf-8")
			const match = content.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/)
			if (match) kanbanBinaryPath = decodeXml(match[1])
		} catch {}
	}

	return { installed, loaded, kanbanBinaryPath }
}
