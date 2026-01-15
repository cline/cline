/**
 * Auth command - manage API provider authentication
 */

import { Command } from "commander"
import * as readline from "readline"
import { getProviderById, getProviderIds, isValidProviderId, PROVIDERS } from "../../core/auth/providers.js"
import { createSecretsStorage, maskApiKey } from "../../core/auth/secrets.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Prompt for input from stdin
 */
async function prompt(question: string, hideInput = false): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		if (hideInput) {
			// Disable echo for password-like input
			process.stdout.write(question)
			let input = ""
			process.stdin.setRawMode?.(true)
			process.stdin.resume()
			process.stdin.on("data", (char) => {
				const c = char.toString()
				if (c === "\n" || c === "\r") {
					process.stdin.setRawMode?.(false)
					process.stdout.write("\n")
					rl.close()
					resolve(input)
				} else if (c === "\u0003") {
					// Ctrl+C
					process.exit(0)
				} else if (c === "\u007F") {
					// Backspace
					if (input.length > 0) {
						input = input.slice(0, -1)
					}
				} else {
					input += c
				}
			})
		} else {
			rl.question(question, (answer) => {
				rl.close()
				resolve(answer)
			})
		}
	})
}

/**
 * Interactive provider selection wizard
 */
async function runInteractiveWizard(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	fmt.info("Select an API provider to configure:\n")

	// Display providers
	PROVIDERS.forEach((provider, index) => {
		const num = index + 1
		fmt.raw(`  ${num}. ${provider.name}`)
		fmt.raw(`     ${provider.description}`)
		if (provider.requiresApiKey) {
			fmt.raw(`     Requires API key${provider.keyUrl ? ` (${provider.keyUrl})` : ""}`)
		} else {
			fmt.raw("     No API key required")
		}
		fmt.raw("")
	})

	// Get selection
	const selection = await prompt("Enter number (1-" + PROVIDERS.length + "): ")
	const index = parseInt(selection, 10) - 1

	if (isNaN(index) || index < 0 || index >= PROVIDERS.length) {
		fmt.error("Invalid selection")
		return
	}

	const provider = PROVIDERS[index]
	logger.debug(`Selected provider: ${provider.id}`)

	if (!provider.requiresApiKey) {
		fmt.success(`${provider.name} does not require an API key.`)
		fmt.info("You can start using it immediately.")
		return
	}

	// Prompt for API key
	if (provider.keyUrl) {
		fmt.info(`Get your API key at: ${provider.keyUrl}`)
	}

	const apiKey = await prompt("Enter API key: ", true)

	if (!apiKey.trim()) {
		fmt.error("No API key provided")
		return
	}

	// Store the key
	const secrets = createSecretsStorage(config.configDir)
	secrets.setApiKey(provider.id, apiKey.trim())

	fmt.success(`API key saved for ${provider.name}`)
}

/**
 * Create the auth command
 */
export function createAuthCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const authCommand = new Command("auth")
		.alias("a")
		.description("Manage API provider authentication")
		.argument("[provider]", "Provider ID (e.g., anthropic, openrouter, openai)")
		.argument("[key]", "API key to set")
		.option("-l, --list", "List configured providers")
		.option("-d, --delete <provider>", "Delete API key for provider")
		.action(async (provider: string | undefined, key: string | undefined, options) => {
			logger.debug("Auth command called", { provider, hasKey: !!key, options })

			const secrets = createSecretsStorage(config.configDir)

			// List configured providers
			if (options.list) {
				const configured = secrets.listProviders()
				if (configured.length === 0) {
					formatter.info("No API keys configured")
				} else {
					formatter.info("Configured providers:")
					for (const id of configured) {
						const providerInfo = getProviderById(id)
						const apiKey = secrets.getApiKey(id)
						const masked = apiKey ? maskApiKey(apiKey) : "(no key)"
						formatter.raw(`  ${providerInfo?.name || id}: ${masked}`)
					}
				}
				return
			}

			// Delete provider key
			if (options.delete) {
				const providerId = options.delete
				if (!isValidProviderId(providerId)) {
					formatter.warn(`Unknown provider: ${providerId}`)
				}
				if (secrets.deleteApiKey(providerId)) {
					formatter.success(`Deleted API key for ${providerId}`)
				} else {
					formatter.info(`No API key stored for ${providerId}`)
				}
				return
			}

			// No provider specified - run interactive wizard
			if (!provider) {
				await runInteractiveWizard(config, logger, formatter)
				return
			}

			// Validate provider
			if (!isValidProviderId(provider)) {
				formatter.error(`Unknown provider: ${provider}`)
				formatter.info(`Valid providers: ${getProviderIds().join(", ")}`)
				return
			}

			const providerInfo = getProviderById(provider)!

			// No key specified - prompt for it
			if (!key) {
				if (!providerInfo.requiresApiKey) {
					formatter.success(`${providerInfo.name} does not require an API key.`)
					return
				}

				if (providerInfo.keyUrl) {
					formatter.info(`Get your API key at: ${providerInfo.keyUrl}`)
				}

				key = await prompt("Enter API key: ", true)
				if (!key.trim()) {
					formatter.error("No API key provided")
					return
				}
			}

			// Store the key
			secrets.setApiKey(provider, key.trim())
			formatter.success(`API key saved for ${providerInfo.name}`)
		})

	return authCommand
}
