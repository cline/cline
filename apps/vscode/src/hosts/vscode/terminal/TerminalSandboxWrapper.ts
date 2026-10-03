import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export interface TerminalSandboxOptions {
	/** Whether sandboxed execution mode is enabled. */
	enabled: boolean
	/** Filesystem containment level. */
	containment?: "workspace-only" | "read-only-root" | "strict"
	/** Whether network egress is allowed. */
	allowNetwork?: boolean
	/** Additional paths to mask/block. */
	blockedPaths?: string[]
	/** Paths where writes are permitted (defaults to workspace cwd and /tmp). */
	allowedWritePaths?: string[]
	/** Custom command wrapper template with {command} and {cwd} placeholders. */
	customWrapper?: string
	/** Backend isolation strategy. */
	backend?: "auto" | "vetto" | "bwrap" | "sandbox-exec" | "shell-guard"
}

export type SandboxBackend = "vetto" | "bwrap" | "sandbox-exec" | "shell-guard"

/**
 * Escapes an argument for safe insertion into POSIX shell commands.
 */
export function quoteShellArg(arg: string): string {
	if (arg.length === 0) {
		return "''"
	}
	if (!/[\s"'\\$`!&|;<>(){}[\]*?~]/.test(arg)) {
		return arg
	}
	return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * Check if the Vetto sandbox runtime binary is available on the host.
 */
export function isVettoAvailable(): boolean {
	const candidatePaths = [
		path.join(os.homedir(), ".local", "bin", "vetto"),
		path.join(os.homedir(), ".cargo", "bin", "vetto"),
		"/usr/local/bin/vetto",
		"/usr/bin/vetto",
	]
	for (const p of candidatePaths) {
		try {
			if (fs.existsSync(p)) {
				return true
			}
		} catch {
			// ignore permission / fs errors
		}
	}

	const pathEnv = process.env.PATH || ""
	const dirs = pathEnv.split(path.delimiter)
	for (const dir of dirs) {
		try {
			const candidate = path.join(dir, process.platform === "win32" ? "vetto.exe" : "vetto")
			if (fs.existsSync(candidate)) {
				return true
			}
		} catch {
			// ignore
		}
	}
	return false
}

/**
 * Check if Bubblewrap (bwrap) is available on Linux.
 */
export function isBwrapAvailable(): boolean {
	if (process.platform !== "linux") {
		return false
	}
	const candidatePaths = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"]
	for (const p of candidatePaths) {
		try {
			if (fs.existsSync(p)) {
				return true
			}
		} catch {
			// ignore
		}
	}
	return false
}

/**
 * Check if macOS Seatbelt (sandbox-exec) is available on macOS.
 */
export function isSandboxExecAvailable(): boolean {
	if (process.platform !== "darwin") {
		return false
	}
	try {
		return fs.existsSync("/usr/bin/sandbox-exec")
	} catch {
		return false
	}
}

/**
 * Automatically detect the best available sandbox backend.
 */
export function detectSandboxBackend(preferred?: "auto" | "vetto" | "bwrap" | "sandbox-exec" | "shell-guard"): SandboxBackend {
	if (preferred && preferred !== "auto") {
		return preferred
	}
	if (isVettoAvailable()) {
		return "vetto"
	}
	if (process.platform === "linux" && isBwrapAvailable()) {
		return "bwrap"
	}
	if (process.platform === "darwin" && isSandboxExecAvailable()) {
		return "sandbox-exec"
	}
	return "shell-guard"
}

/**
 * Wraps a shell command with the configured sandboxed execution containment.
 *
 * @param command - The original raw terminal command
 * @param cwd - The target working directory for the command
 * @param options - Sandbox options controlling containment and backend
 * @returns The wrapped sandboxed command string
 */
export function wrapSandboxedCommand(command: string, cwd: string, options?: TerminalSandboxOptions): string {
	if (!options || !options.enabled) {
		return command
	}

	const safeCwd = cwd || process.cwd()

	// 1. Custom wrapper template override
	if (options.customWrapper) {
		return options.customWrapper
			.replace(/\{cwd\}/g, quoteShellArg(safeCwd))
			.replace(/\{command\}/g, command)
	}

	const backend = detectSandboxBackend(options.backend)

	switch (backend) {
		case "vetto": {
			// Vetto provides kernel-enforced Landlock LSM and Seccomp-BPF isolation
			return `vetto --tui none -- ${command}`
		}

		case "bwrap": {
			// Linux Bubblewrap unprivileged user and mount namespace isolation
			const homedir = os.homedir()
			const bwrapArgs: string[] = [
				"bwrap",
				"--ro-bind", "/", "/",
				"--dev-bind", "/dev", "/dev",
				"--proc", "/proc",
				"--bind", quoteShellArg(safeCwd), quoteShellArg(safeCwd),
				"--tmpfs", "/tmp",
			]

			const sensitiveDirs = [".ssh", ".aws", ".gnupg", ".azure", ".kube"]
			for (const dir of sensitiveDirs) {
				const fullPath = path.join(homedir, dir)
				bwrapArgs.push("--tmpfs", quoteShellArg(fullPath))
			}

			if (options.blockedPaths) {
				for (const bp of options.blockedPaths) {
					bwrapArgs.push("--tmpfs", quoteShellArg(bp))
				}
			}

			bwrapArgs.push("--chdir", quoteShellArg(safeCwd))
			bwrapArgs.push("--", "/bin/sh", "-c", quoteShellArg(command))
			return bwrapArgs.join(" ")
		}

		case "sandbox-exec": {
			// macOS Seatbelt SBPL profile
			const homedir = os.homedir()
			const sshPath = path.join(homedir, ".ssh")
			const profile = `(version 1)(allow default)(deny file-write* (subpath "/"))(allow file-write* (subpath "${safeCwd}"))(allow file-write* (subpath "/tmp"))(allow file-write* (subpath "/private/tmp"))(deny file-read* (subpath "${sshPath}"))`
			return `sandbox-exec -p ${quoteShellArg(profile)} /bin/sh -c ${quoteShellArg(command)}`
		}

		case "shell-guard":
		default: {
			if (process.platform === "win32") {
				return `& { $env:CLINE_SANDBOX_ACTIVE="1"; $env:CLINE_SANDBOX_CWD="${safeCwd.replace(/"/g, '`"')}"; ${command} }`
			}

			// Universal POSIX shell containment wrapper
			return `(CLINE_SANDBOX_ACTIVE=1; CLINE_SANDBOX_CWD=${quoteShellArg(safeCwd)}; unset AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN GITHUB_TOKEN GH_TOKEN OPENAI_API_KEY ANTHROPIC_API_KEY; if echo ${quoteShellArg(command)} | grep -qE '\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*\\s+)?(\\/|\\~|\\$HOME|\\.\\.\\/|\\.\\.)(\\s|$)'; then echo "[CLINE SANDBOX ERROR] Destructive out-of-tree command blocked by policy" >&2; exit 125; fi; if echo ${quoteShellArg(command)} | grep -qE '(\\.ssh\\/|\\.aws\\/|id_rsa|id_ed25519|\\.env(\\s|$|\\.))'; then echo "[CLINE SANDBOX ERROR] Access to protected credential path blocked by sandbox policy" >&2; exit 125; fi; ${command})`
		}
	}
}
