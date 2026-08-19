/**
 * propose-bot
 *
 * Lets the default "cline" bot propose creating a new bot during a normal
 * chat conversation. This tool never creates anything itself - it just
 * surfaces a structured proposal that the webview renders as a review card;
 * the user's own click is what actually calls the app's existing, already
 * security-reviewed create_bot/switch_active_bot flow. See
 * apps/cline/sandbox/bot-config.ts's installBuiltinPlugins for why this
 * plugin is only ever installed for the "cline" bot.
 *
 * Plain JavaScript, not TypeScript: the Hub daemon loads a bot's plugins in
 * an isolated child process via `jiti` for on-the-fly TS transpilation, and
 * that dependency isn't resolvable once a plugin lives outside the
 * monorepo's own node_modules tree (as every installed bot plugin does, at
 * ~/.cline/bots/<bot-id>/plugins/). Shipping plain JS sidesteps needing it.
 */

import { createTool } from "@cline/shared";

export const proposeNewBot = createTool({
	name: "propose_new_bot",
	description:
		"Propose creating a new bot (a separate agent identity with its own " +
		"isolated environment) for the user to review. Use this when the user " +
		"asks you to set up, create, or spin up a new bot/agent for a specific " +
		"purpose or project. Provide a suggested name, an optional initial " +
		"project folder to open it into, and a short reason. This does NOT " +
		"create the bot - it shows the user an inline card with your proposal " +
		"and they decide whether to create it. You will not be told whether " +
		"they accepted, so do not wait on or ask about the outcome.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Suggested name for the new bot.",
			},
			initialProjectPath: {
				type: "string",
				description:
					"Optional absolute path to a project folder the new bot should open into.",
			},
			reason: {
				type: "string",
				description: "Short explanation of why this bot is being proposed.",
			},
		},
		required: ["name"],
	},
	async execute(input) {
		return { proposed: true, name: input.name };
	},
});

const plugin = {
	name: "propose-bot",
	manifest: {
		capabilities: ["tools"],
	},
	setup(api) {
		api.registerTool(proposeNewBot);
	},
};

export default plugin;
