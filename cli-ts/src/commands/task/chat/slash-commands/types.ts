/**
 * Types for chat command handlers
 */

import type { Controller } from "@/core/controller"
import type { OutputFormatter } from "../../../../core/output/types.js"
import type { CliConfig } from "../../../../types/config.js"
import type { Logger } from "../../../../types/logger.js"
import type { ChatSession } from "../session.js"

/**
 * Context passed to all command handlers
 */
export interface CommandContext {
	session: ChatSession
	fmt: OutputFormatter
	logger: Logger
	config: CliConfig
	controller: Controller
}

/**
 * Handler function for a chat command
 * @param args - Arguments after the command name
 * @param ctx - Command context with session, formatter, etc.
 * @returns true if the command was handled (input should not be passed to AI)
 */
export type CommandHandler = (args: string[], ctx: CommandContext) => Promise<boolean>
