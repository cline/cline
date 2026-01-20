/**
 * Help command handler
 */

import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Handle /help, /h, /? commands
 */
export const handleHelp: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	ctx.fmt.raw("")
	ctx.fmt.info("Chat commands:")
	ctx.fmt.raw("  /help, /h, /?      - Show this help")
	ctx.fmt.raw("  /plan              - Switch to plan mode")
	ctx.fmt.raw("  /act               - Switch to act mode")
	ctx.fmt.raw("  /mode <plan|act>   - Switch mode")
	ctx.fmt.raw("  /model             - Show current model")
	ctx.fmt.raw("    /model <id>        - Set model for current mode")
	ctx.fmt.raw("    /model list        - List available models (OpenRouter/Cline)")
	ctx.fmt.raw("  /status            - Show task status")
	ctx.fmt.raw("  /cancel            - Cancel current task")
	ctx.fmt.raw("  /approve, /a, /y   - Approve pending action")
	ctx.fmt.raw("  /deny, /d, /n      - Deny pending action")
	ctx.fmt.raw("  /config, /cfg      - Manage configuration")
	ctx.fmt.raw("    /config list     - List all configuration values")
	ctx.fmt.raw("    /config get <key>    - Get a config value")
	ctx.fmt.raw("    /config set <key> <value> - Set a config value")
	ctx.fmt.raw("    /config delete <key> - Reset a config value")
	ctx.fmt.raw("  /quit, /q, /exit   - Exit chat mode")
	ctx.fmt.raw("")
	return true
}
