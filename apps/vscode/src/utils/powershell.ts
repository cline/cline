import * as childProcess from "child_process"
import { Logger } from "@/shared/services/Logger"
import { WINDOWS_POWERSHELL_7_PATH, WINDOWS_POWERSHELL_LEGACY_PATH } from "./shell"

const POWERSHELL_PROBE_TIMEOUT_MS = 1200

let resolvedPowerShellPromise: Promise<string> | null = null
let probeWindowsExecutableImpl: (candidate: string, timeoutMs?: number) => Promise<boolean> = probeWindowsExecutable

function uniquePreserveOrder(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))]
}

function isCommandName(candidate: string): boolean {
	return !candidate.includes("\\") && !candidate.includes("/") && !/^[a-zA-Z]:/.test(candidate)
}

async function resolveWindowsCommandPath(
	commandName: string,
	timeoutMs = POWERSHELL_PROBE_TIMEOUT_MS,
): Promise<string | undefined> {
	const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows"
	const whereCandidates = uniquePreserveOrder([`${systemRoot}\\System32\\where.exe`, "where.exe"])

	for (const whereCommand of whereCandidates) {
		const resolvedPath = await new Promise<string | undefined>((resolve) => {
			const child = childProcess.spawn(whereCommand, [commandName], {
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
				shell: false,
			})

			let settled = false
			let stdout = ""
			let timer: ReturnType<typeof setTimeout>

			const finish = (resolved?: string) => {
				if (settled) {
					return
				}
				settled = true
				clearTimeout(timer)
				resolve(resolved)
			}

			timer = setTimeout(() => {
				if (!child.killed) {
					child.kill("SIGTERM")
				}
				finish()
			}, timeoutMs)

			child.stdout?.on("data", (chunk) => {
				stdout += chunk.toString()
			})
			child.once("error", () => finish())
			child.once("exit", (code) => {
				const firstPath = stdout
					.split(/\r?\n/)
					.map((line) => line.trim())
					.find(Boolean)
				finish(code === 0 ? firstPath : undefined)
			})
		})

		if (resolvedPath) {
			return resolvedPath
		}
	}

	return undefined
}

export function getFallbackWindowsPowerShellPath(): string {
	return WINDOWS_POWERSHELL_LEGACY_PATH
}

export function getWindowsPowerShellCandidates(): string[] {
	const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files"

	const envAbsoluteCandidates = [
		`${programFiles}\\PowerShell\\7\\pwsh.exe`,
		`${programFiles}\\PowerShell\\6\\pwsh.exe`,
		WINDOWS_POWERSHELL_7_PATH,
		WINDOWS_POWERSHELL_LEGACY_PATH,
	]

	const commandNameFallbacks = ["pwsh.exe", "pwsh", "powershell.exe", "powershell"]

	return uniquePreserveOrder([...envAbsoluteCandidates, ...commandNameFallbacks])
}

export function resetPowerShellResolverCacheForTesting(): void {
	resolvedPowerShellPromise = null
	probeWindowsExecutableImpl = probeWindowsExecutable
}

export function setPowerShellProbeForTesting(
	probeFn: ((candidate: string, timeoutMs?: number) => Promise<boolean>) | null,
): void {
	probeWindowsExecutableImpl = probeFn ?? probeWindowsExecutable
}

export async function probeWindowsExecutable(candidate: string, timeoutMs = POWERSHELL_PROBE_TIMEOUT_MS): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const child = childProcess.spawn(candidate, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion"], {
			stdio: "ignore",
			windowsHide: true,
			shell: false,
		})

		let settled = false

		const finish = (isAvailable: boolean) => {
			if (settled) {
				return
			}
			settled = true
			clearTimeout(timer)
			resolve(isAvailable)
		}

		const timer = setTimeout(() => {
			if (!child.killed) {
				child.kill("SIGTERM")
			}
			finish(false)
		}, timeoutMs)

		child.once("error", () => finish(false))
		child.once("exit", (code) => finish(code === 0))
	})
}

export async function resolveWindowsPowerShellExecutable(): Promise<string> {
	if (!resolvedPowerShellPromise) {
		resolvedPowerShellPromise = (async () => {
			const candidates = getWindowsPowerShellCandidates()

			for (const candidate of candidates) {
				if (await probeWindowsExecutableImpl(candidate)) {
					const executable = isCommandName(candidate) ? await resolveWindowsCommandPath(candidate) : candidate
					if (!executable) {
						Logger.debug(`[PowerShellResolver] Skipping unresolved PowerShell command candidate: ${candidate}`)
						continue
					}
					Logger.debug(`[PowerShellResolver] Using PowerShell executable: ${executable}`)
					return executable
				}
			}

			const fallback = getFallbackWindowsPowerShellPath()
			Logger.warn(
				`[PowerShellResolver] Could not resolve PowerShell executable from candidates ${candidates.join(", ")}. Falling back to ${fallback}.`,
			)
			return fallback
		})()
	}

	return resolvedPowerShellPromise
}
