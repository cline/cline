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
	override name = "CredentialStorage"
	private readonly commands: PlatformCommand

	constructor() {
		super()
		const platform = getPlatformOS()
		const commands = PLATFORM_COMMANDS[platform]

		if (!commands) {
			throw new Error(`Unsupported platform: ${platform}`)
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
		} catch (error) {
			// Return undefined if the key doesn't exist (expected behavior)
			// "The specified item could not be found" is not an error, just means key doesn't exist
			if (error instanceof Error && error.message.includes("could not be found")) {
				return undefined
			}
			throw error
		}
	}

	protected async _store(key: string, value: string): Promise<void> {
		const { service, account, target } = this.getCredentialIdentifiers(key)
		try {
			// Best-effort replace: delete first (ignore errors), then store
			try {
				await this.exec(this.commands.delete({ service, account, target }))
			} catch {}
			await this.exec(this.commands.store({ service, account, target, value }))
		} catch (error) {
			throw error
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
}

const PLATFORM_COMMANDS: PlatformCommands = {
	[PLATFORM_OS.MacOS]: {
		get: ({ service, account }) => {
			const keychain = process.env.CLINE_KEYCHAIN
			const args = ["find-generic-password", "-s", service, "-a", account, "-w"]
			// Note: find-generic-password doesn't support -k flag
			// If using a custom keychain, specify it at the end as a positional argument
			if (keychain && keychain.length > 0) {
				args.push(keychain)
			}
			return { command: "security", args }
		},
		store: ({ service, account, value }) => {
			const keychain = process.env.CLINE_KEYCHAIN
			const args = ["add-generic-password", "-s", service, "-a", account]
			// For test keychains, allow all apps to access (makes it manageable in Keychain Access)
			if (keychain && keychain.length > 0) {
				args.push("-A")
			}
			args.push("-w", value)
			// Keychain must be specified as positional argument at the end
			if (keychain && keychain.length > 0) {
				args.push(keychain)
			}
			return { command: "security", args }
		},
		delete: ({ service, account }) => {
			const keychain = process.env.CLINE_KEYCHAIN
			const args = ["delete-generic-password", "-s", service, "-a", account]
			if (keychain && keychain.length > 0) {
				args.push("-k", keychain)
			}
			return { command: "security", args }
		},
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
				"param($Target); $cred = Get-StoredCredential -Target $Target; if ($cred) { $cred.GetNetworkCredential().Password } else { '' }",
				"-Target",
				target || "",
			],
		}),
		store: ({ target, value }) => ({
			command: "powershell.exe",
			args: [
				"-Command",
				"param($Target, $Value); $pass = ConvertTo-SecureString $Value -AsPlainText -Force; New-StoredCredential -Target $Target -UserName 'Cline' -SecurePassword $pass -Persist LocalMachine",
				"-Target",
				target || "",
				"-Value",
				value,
			],
		}),
		delete: ({ target }) => ({
			command: "powershell.exe",
			args: [
				"-Command",
				"param($Target); $cred = Get-StoredCredential -Target $Target; if ($cred) { Remove-StoredCredential -Target $Target }",
				"-Target",
				target || "",
			],
		}),
	},
}
