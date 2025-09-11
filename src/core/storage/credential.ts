import { spawn } from "node:child_process"
import { getPlatformOS, PLATFORM_OS } from "@/utils/platform"
import { ClineStorage } from "./ClineStorage"

type CommandSpec = { command: string; args: string[]; stdin?: string }

interface CommandArgs {
	service: string
	account: string
	target?: string
}

interface CommandStoreArgs extends CommandArgs {
	value: string
}

interface PlatformCommand {
	get: (options: CommandArgs) => CommandSpec
	store: (options: CommandStoreArgs) => CommandSpec
	delete: (options: CommandArgs) => CommandSpec
}

interface PlatformCommands {
	[PLATFORM_OS.Win32]: PlatformCommand
	[PLATFORM_OS.Linux]: PlatformCommand
	[PLATFORM_OS.MacOS]: PlatformCommand
}

export class CredentialStorage extends ClineStorage {
	private readonly commands: PlatformCommand

	constructor() {
		super()
		const platform = getPlatformOS()
		const commands = PLATFORM_COMMANDS[platform]

		if (!commands) {
			throw new Error(`Unsupported platform: ${platform}`)
		}

		if (platform === PLATFORM_OS.Win32) {
			this.initWindowsCredentialManager()
		}

		this.commands = commands
	}

	private getCredentialIdentifiers(key: string) {
		const service = `Cline: ${key}`
		const account = `cline_${key}`
		const target = `${service}:${account}`.replaceAll('"', "_")
		return { service, account, target }
	}

	protected async _get(key: string): Promise<string | undefined> {
		const { service, account, target } = this.getCredentialIdentifiers(key)
		try {
			const result = await this.exec(this.commands.get({ service, account, target }))
			return result || undefined
		} catch {
			console.error(`Failed to get credential for ${key}`)
			return undefined
		}
	}

	protected async _store(key: string, value: string): Promise<void> {
		const { service, account, target } = this.getCredentialIdentifiers(key)
		try {
			await this.exec(this.commands.store({ service, account, target, value }))
		} catch {
			console.error(`Failed to store credential for ${key}`)
		}
	}

	protected async _delete(key: string): Promise<void> {
		const { service, account, target } = this.getCredentialIdentifiers(key)
		try {
			await this.exec(this.commands.delete({ service, account, target }))
		} catch {
			// Ignore deletion errors (key might not exist)
		}
	}

	private exec({ command, args, stdin }: CommandSpec): Promise<string> {
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

			child.once("close", (code) => {
				code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} failed: ${stderr || stdout}`))
			})

			child.once("error", reject)
		})
	}

	private initWindowsCredentialManager(): void {
		this.exec({
			command: "powershell.exe",
			args: [
				"-Command",
				"if (-not (Get-Module -ListAvailable -Name CredentialManager)) { Install-Module -Name CredentialManager -Force -Scope CurrentUser }",
			],
		})
	}
}

const PLATFORM_COMMANDS: PlatformCommands = {
	[PLATFORM_OS.MacOS]: {
		get: ({ service, account }) => ({
			command: "security",
			args: ["find-generic-password", "-s", service, "-a", account, "-w"],
		}),
		store: ({ service, account, value }) => ({
			command: "security",
			args: ["add-generic-password", "-s", service, "-a", account, "-w", value],
		}),
		delete: ({ service, account }) => ({
			command: "security",
			args: ["delete-generic-password", "-s", service, "-a", account],
		}),
	},
	[PLATFORM_OS.Linux]: {
		get: ({ service, account }) => ({
			command: "secret-tool",
			args: ["lookup", "service", service, "account", account],
		}),
		store: ({ service, account, value }) => ({
			command: "secret-tool",
			args: ["store", "--label", service, "service", service, "account", account],
			stdin: value,
		}),
		delete: ({ service, account }) => ({
			command: "secret-tool",
			args: ["clear", "service", service, "account", account],
		}),
	},
	[PLATFORM_OS.Win32]: {
		get: ({ target }) => ({
			command: "powershell.exe",
			args: [
				"-Command",
				`$cred = Get-StoredCredential -Target "${target}"; if ($cred) { $cred.GetNetworkCredential().Password } else { "" }`,
			],
		}),
		store: ({ target, value }) => ({
			command: "powershell.exe",
			args: [
				"-Command",
				`$pass = ConvertTo-SecureString '${value}' -AsPlainText -Force; New-StoredCredential -Target '${target}' -UserName 'Cline' -SecurePassword $pass -Persist LocalMachine`,
			],
		}),
		delete: ({ target }) => ({
			command: "powershell.exe",
			args: [
				"-Command",
				`$cred = Get-StoredCredential -Target '${target}'; if ($cred) { Remove-StoredCredential -Target '${target}' }`,
			],
		}),
	},
}
