import type { BotRecord } from "@cline/bot";
import { createTool } from "@cline/shared";

export const LIST_BOTS_TOOL = "list_bots";
export const PROPOSE_NEW_BOT_TOOL = "propose_new_bot";
export const MAX_ACTIVE_BOTS = 5;

export interface BotToolSource {
	listBots(): readonly BotRecord[];
}

export interface ProposeNewBotInput {
	name?: string;
	initialProjectPath?: string;
	reason?: string;
	systemPrompt?: string;
}

function trimmedOptional(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

export function createListBotsTool(source: BotToolSource) {
	return createTool({
		name: LIST_BOTS_TOOL,
		description:
			"List the active bots available in this Cline Gateway. Returns each bot's stable id, user-facing name, role, and status, plus whether another bot can be created. Use this before proposing or referring to another bot.",
		inputSchema: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
		execute: async () => {
			const bots = source
				.listBots()
				.filter((bot) => bot.status === "active")
				.map((bot) => ({
					id: bot.identity.botId,
					name: bot.identity.name,
					role: bot.identity.role,
					status: bot.status,
				}));
			return {
				bots,
				count: bots.length,
				maxActiveBots: MAX_ACTIVE_BOTS,
				canCreateBot: bots.length < MAX_ACTIVE_BOTS,
			};
		},
	});
}

export function createProposeNewBotTool(source: BotToolSource) {
	return createTool({
		name: PROPOSE_NEW_BOT_TOOL,
		description:
			"Propose a new worker bot for the user to review and create in the Cline desktop app. Call list_bots first. This tool does not create the bot: it displays a confirmation card, and the user must click Create this bot. Never claim creation from this tool result alone.",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					minLength: 1,
					maxLength: 80,
					description: "Short, user-facing name for the new bot.",
				},
				initialProjectPath: {
					type: "string",
					minLength: 1,
					description:
						"Optional absolute path to the project the user wants to grant to the new bot.",
				},
				reason: {
					type: "string",
					maxLength: 500,
					description:
						"Brief user-facing explanation of why this separate bot is useful.",
				},
				systemPrompt: {
					type: "string",
					maxLength: 12_000,
					description:
						"Optional durable instructions defining the new bot's role and behavior.",
				},
			},
			required: ["name"],
			additionalProperties: false,
		},
		execute: async (input: unknown) => {
			const proposal =
				typeof input === "object" && input !== null
					? (input as ProposeNewBotInput)
					: {};
			const name = trimmedOptional(proposal.name);
			if (!name) return { error: "Bot name is required." };
			if (name.length > 80)
				return { error: "Bot name must be 80 characters or fewer." };

			const activeBotCount = source
				.listBots()
				.filter((bot) => bot.status === "active").length;
			if (activeBotCount >= MAX_ACTIVE_BOTS) {
				return {
					error: `The maximum of ${MAX_ACTIVE_BOTS} active bots has been reached.`,
					canCreateBot: false,
				};
			}

			const reason = trimmedOptional(proposal.reason);
			const systemPrompt = trimmedOptional(proposal.systemPrompt);
			const initialProjectPath = trimmedOptional(proposal.initialProjectPath);
			if (reason && reason.length > 500)
				return { error: "Proposal reason must be 500 characters or fewer." };
			if (systemPrompt && systemPrompt.length > 12_000)
				return {
					error: "Bot instructions must be 12,000 characters or fewer.",
				};

			return {
				proposed: true,
				requiresUserConfirmation: true,
				name,
				...(initialProjectPath ? { initialProjectPath } : {}),
				...(reason ? { reason } : {}),
				...(systemPrompt ? { systemPrompt } : {}),
				message:
					"The proposal is ready for review. The bot has not been created; wait for the user to use the confirmation card.",
			};
		},
	});
}
