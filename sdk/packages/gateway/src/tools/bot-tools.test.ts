import type { BotRecord } from "@cline/bot";
import { createBotId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import {
	createListBotsTool,
	createProposeNewBotTool,
	MAX_ACTIVE_BOTS,
} from "./bot-tools";

const context = { agentId: "cline-dad", iteration: 1 };

function bot(
	name: string,
	role: BotRecord["identity"]["role"] = "worker",
	status: BotRecord["status"] = "active",
): BotRecord {
	return {
		identity: {
			botId: createBotId(),
			name,
			role,
			parentBotId: null,
			provenance: { createdBy: "bootstrap" },
			createdAt: 1,
		},
		config: {},
		status,
		revision: 0,
	};
}

describe("native Gateway bot tools", () => {
	it("lists the authoritative active bot roster and capacity", async () => {
		const records = [
			bot("Cline Dad", "lead"),
			bot("Research"),
			bot("Old Bot", "worker", "retired"),
		];
		const tool = createListBotsTool({ listBots: () => records });

		await expect(tool.execute({}, context)).resolves.toEqual({
			bots: [
				expect.objectContaining({ name: "Cline Dad", role: "lead" }),
				expect.objectContaining({ name: "Research", role: "worker" }),
			],
			count: 2,
			maxActiveBots: MAX_ACTIVE_BOTS,
			canCreateBot: true,
		});
	});

	it("normalizes a user-confirmed bot proposal", async () => {
		const tool = createProposeNewBotTool({
			listBots: () => [bot("Cline Dad", "lead")],
		});

		await expect(
			tool.execute(
				{
					name: "  Review Bot  ",
					initialProjectPath: "  /Users/me/project  ",
					reason: "  Keep reviews separate.  ",
					systemPrompt: "  Review changes carefully.  ",
				},
				context,
			),
		).resolves.toEqual({
			proposed: true,
			requiresUserConfirmation: true,
			name: "Review Bot",
			initialProjectPath: "/Users/me/project",
			reason: "Keep reviews separate.",
			systemPrompt: "Review changes carefully.",
			message:
				"The proposal is ready for review. The bot has not been created; wait for the user to use the confirmation card.",
		});
	});

	it("refuses to propose beyond the active bot limit", async () => {
		const records = Array.from({ length: MAX_ACTIVE_BOTS }, (_, index) =>
			bot(`Bot ${index + 1}`),
		);
		const tool = createProposeNewBotTool({ listBots: () => records });

		await expect(
			tool.execute({ name: "One Too Many" }, context),
		).resolves.toEqual({
			error: `The maximum of ${MAX_ACTIVE_BOTS} active bots has been reached.`,
			canCreateBot: false,
		});
	});
});
