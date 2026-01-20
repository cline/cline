/**
 * Config command handler
 */

import fs from "fs"
import path from "path"
import { getNestedValue, parseValue, setNestedValue } from "../../../config/index.js"
import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Handle /config, /cfg commands
 */
export const handleConfig: CommandHandler = async (args: string[], ctx: CommandContext): Promise<boolean> => {
	const subCmd = args[0]?.toLowerCase()
	const configKey = args[1]
	const configValue = args.slice(2).join(" ")

	if (!subCmd || subCmd === "list" || subCmd === "ls") {
		// List all config values
		try {
			const configDir = ctx.config.configDir || `${process.env.HOME}/.cline`
			const globalStatePath = path.join(configDir, "data", "globalState.json")

			if (fs.existsSync(globalStatePath)) {
				const content = fs.readFileSync(globalStatePath, "utf-8")
				const allSettings = JSON.parse(content)
				ctx.fmt.raw("")
				ctx.fmt.raw(JSON.stringify(allSettings, null, 2))
				ctx.fmt.raw("")
			} else {
				ctx.fmt.info("No configuration file found")
			}
		} catch (err) {
			ctx.fmt.error(`Failed to list config: ${(err as Error).message}`)
		}
		return true
	}

	if (subCmd === "get") {
		if (!configKey) {
			ctx.fmt.error("Usage: /config get <key>")
			return true
		}

		try {
			let value: unknown

			if (configKey.includes(".")) {
				// For nested paths, get the root object first
				const rootKey = configKey.split(".")[0]
				let rootValue = ctx.controller.stateManager.getGlobalSettingsKey(rootKey as any)
				if (rootValue === undefined) {
					rootValue = ctx.controller.stateManager.getGlobalStateKey(rootKey as any)
				}

				if (rootValue !== undefined && typeof rootValue === "object") {
					value = getNestedValue({ [rootKey]: rootValue }, configKey)
				}
			} else {
				value = ctx.controller.stateManager.getGlobalSettingsKey(configKey as any)
				if (value === undefined) {
					value = ctx.controller.stateManager.getGlobalStateKey(configKey as any)
				}
			}

			if (value === undefined) {
				ctx.fmt.info(`${configKey} is not set`)
			} else {
				const displayValue = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)
				ctx.fmt.keyValue({ [configKey]: displayValue })
			}
		} catch (err) {
			ctx.fmt.error(`Failed to get config: ${(err as Error).message}`)
		}
		return true
	}

	if (subCmd === "set") {
		if (!configKey || !configValue) {
			ctx.fmt.error("Usage: /config set <key> <value>")
			return true
		}

		try {
			const parsedValue = parseValue(configKey, configValue)

			if (configKey.includes(".")) {
				// For nested paths, get the current root object, modify it, and save the whole thing
				const rootKey = configKey.split(".")[0]
				let rootValue = ctx.controller.stateManager.getGlobalSettingsKey(rootKey as any)
				if (rootValue === undefined) {
					rootValue = ctx.controller.stateManager.getGlobalStateKey(rootKey as any)
				}

				const currentRoot = rootValue !== undefined && typeof rootValue === "object" ? rootValue : {}
				const { rootValue: newRootValue } = setNestedValue({ [rootKey]: currentRoot }, configKey, parsedValue)

				ctx.controller.stateManager.setGlobalState(rootKey as any, newRootValue as any)
			} else {
				ctx.controller.stateManager.setGlobalState(configKey as any, parsedValue as any)
			}

			await ctx.controller.stateManager.flushPendingState()
			ctx.fmt.success(`Set ${configKey} = ${String(parsedValue)}`)
		} catch (err) {
			ctx.fmt.error(`Failed to set config: ${(err as Error).message}`)
		}
		return true
	}

	if (subCmd === "delete" || subCmd === "rm") {
		if (!configKey) {
			ctx.fmt.error("Usage: /config delete <key>")
			return true
		}

		try {
			ctx.controller.stateManager.setGlobalState(configKey as any, undefined)
			await ctx.controller.stateManager.flushPendingState()
			ctx.fmt.success(`Reset ${configKey} to default`)
		} catch (err) {
			ctx.fmt.error(`Failed to delete config: ${(err as Error).message}`)
		}
		return true
	}

	ctx.fmt.error(`Unknown config subcommand: ${subCmd}`)
	ctx.fmt.raw("Usage: /config <list|get|set|delete> [key] [value]")
	return true
}
