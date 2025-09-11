import { spawn } from "node:child_process"
import os from "node:os"
import { ClineStorage } from "./stateless"

// Platform-specific command configurations
type CommandResult = [string, string[]]
type LinuxStoreResult = [string, string[], string]

interface CommandOptions {
	service: string
	account: string
	target?: string
}

interface CommandStoreArgs extends CommandOptions {
	value: string
}

interface PlatformCommands {
	darwin: {
		get: (options: CommandOptions) => CommandResult
		store: (options: CommandStoreArgs) => CommandResult
		delete: (options: CommandOptions) => CommandResult
	}
	win32: {
		get: (options: CommandOptions) => CommandResult
		store: (options: CommandStoreArgs) => CommandResult
		delete: (options: CommandOptions) => CommandResult
	}
	linux: {
		get: (options: CommandOptions) => CommandResult
		store: (options: CommandStoreArgs) => LinuxStoreResult
		delete: (options: CommandOptions) => CommandResult
	}
}

const PLATFORM_COMMANDS: PlatformCommands = {
	darwin: {
		get: (options: CommandOptions): CommandResult => [
			"security",
			["find-generic-password", "-s", options.service, "-a", options.account, "-w"],
		],
		store: (options: CommandStoreArgs): CommandResult => [
			"security",
			["add-generic-password", "-s", options.service, "-a", options.account, "-w", options.value],
		],
		delete: (options: CommandOptions): CommandResult => [
			"security",
			["delete-generic-password", "-s", options.service, "-a", options.account],
		],
	},
	win32: {
		get: (options: CommandOptions): CommandResult => [
			"powershell.exe",
			[
				"-Command",
				`$cred = Get-StoredCredential -Target "${options.target}"; if ($cred) { $cred.GetNetworkCredential().Password } else { "" }`,
			],
		],
		store: (options: CommandStoreArgs): CommandResult => [
			"powershell.exe",
			[
				"-Command",
				`$pass = ConvertTo-SecureString '${options.value}' -AsPlainText -Force; New-StoredCredential -Target '${options.target}' -UserName 'Cline' -SecurePassword $pass -Persist LocalMachine`,
			],
		],
		delete: (options: CommandOptions): CommandResult => [
			"powershell.exe",
			[
				"-Command",
				`$cred = Get-StoredCredential -Target '${options.target}'; if ($cred) { Remove-StoredCredential -Target '${options.target}' }`,
			],
		],
	},
	linux: {
		get: (options: CommandOptions): CommandResult => [
			"secret-tool",
			["lookup", "service", options.service, "account", options.account],
		],
		store: (options: CommandStoreArgs): LinuxStoreResult => [
			"secret-tool",
			["store", "--label", options.service, "service", options.service, "account", options.account],
			options.value,
		],
		delete: (options: CommandOptions): CommandResult => [
			"secret-tool",
			["clear", "service", options.service, "account", options.account],
		],
	},
}

export class CredentialStorage extends ClineStorage {
	private readonly platform: keyof typeof PLATFORM_COMMANDS

	constructor() {
		super()
		const platform = os.platform()
		this.platform = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux"
		console.info("[CredentialStorage]", this.platform)
		if (!PLATFORM_COMMANDS[this.platform]) {
			throw new Error(`Unsupported platform: ${this.platform}`)
		}

		// Initialize Windows credential manager if needed
		if (this.platform === "win32") {
			this.initWindowsCredentialManager()
		}
	}

	override async get(key: string): Promise<string | undefined> {
		const { service, account, target } = this.getCredentialIdentifiers(key)

		try {
			const commandResult = this.getCommand(service, account, target)
			const [command, args] = commandResult

			const result = await this.exec(command, args)
			return result || undefined
		} catch {
			return undefined
		}
	}

	override async store(key: string, value: string): Promise<void> {
		const { service, account, target } = this.getCredentialIdentifiers(key)

		const { command, args, stdin } = this.getStoreCommand(service, account, target, value)
		await this.exec(command, args, stdin)
	}

	override async delete(key: string): Promise<void> {
		const { service, account, target } = this.getCredentialIdentifiers(key)

		try {
			const commandResult = this.getDeleteCommand(service, account, target)
			const [command, args] = commandResult

			await this.exec(command, args)
		} catch {
			// Ignore deletion errors (key might not exist)
		}
	}

	private getCommand(service: string, account: string, target: string): CommandResult {
		if (this.platform === "win32") {
			return PLATFORM_COMMANDS.win32.get({ service, account, target })
		} else if (this.platform === "linux") {
			return PLATFORM_COMMANDS.linux.get({ service, account })
		} else {
			return PLATFORM_COMMANDS.darwin.get({ service, account })
		}
	}

	private getStoreCommand(
		service: string,
		account: string,
		target: string,
		value: string,
	): { command: string; args: string[]; stdin?: string } {
		if (this.platform === "win32") {
			const [command, args] = PLATFORM_COMMANDS.win32.store({ service, account, target, value })
			return { command, args }
		} else if (this.platform === "linux") {
			const [command, args, stdin] = PLATFORM_COMMANDS.linux.store({ service, account, value })
			return { command, args, stdin }
		} else {
			const [command, args] = PLATFORM_COMMANDS.darwin.store({ service, account, value })
			return { command, args }
		}
	}

	private getDeleteCommand(service: string, account: string, target: string): CommandResult {
		if (this.platform === "win32") {
			return PLATFORM_COMMANDS.win32.delete({ service, account, target })
		} else if (this.platform === "linux") {
			return PLATFORM_COMMANDS.linux.delete({ service, account })
		} else {
			return PLATFORM_COMMANDS.darwin.delete({ service, account })
		}
	}

	private getCredentialIdentifiers(key: string) {
		const service = `Cline: ${key}`
		const account = `cline_${key}`
		const target = `${service}:${account}`.replaceAll('"', "_")
		return { service, account, target }
	}

	private exec(command: string, args: string[], stdin?: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { stdio: "pipe" })
			let stdout = ""
			let stderr = ""

			child.stdout.on("data", (data) => {
				stdout += data
			})
			child.stderr.on("data", (data) => {
				stderr += data
			})

			if (stdin !== undefined) {
				child.stdin.write(stdin)
				child.stdin.end()
			}

			child.on("exit", (code) => {
				code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} failed: ${stderr || stdout}`))
			})

			child.on("error", reject)
		})
	}

	private initWindowsCredentialManager(): void {
		this.exec("powershell.exe", [
			"-Command",
			"if (-not (Get-Module -ListAvailable -Name CredentialManager)) { Install-Module -Name CredentialManager -Force -Scope CurrentUser }",
		]).catch((error) => console.error("CredentialStorage", error))
	}
}
