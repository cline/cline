import { describe, expect, it } from "vitest";
import plugin, {
	type GatewaySupportApi,
	type GatewaySupportTool,
	proposeNewBot,
} from "../default-agent/cline-dad/plugins/cline-support";

describe("Cline Dad bot proposals", () => {
	it("registers propose_new_bot with the bundled support tools", async () => {
		const tools: GatewaySupportTool[] = [];
		await plugin.setup({
			registerTool(tool) {
				tools.push(tool);
			},
			registerCommand() {},
			registerRule() {},
		} satisfies GatewaySupportApi);

		expect(tools.map((tool) => tool.name)).toContain("propose_new_bot");
	});

	it("normalizes a proposal and makes confirmation explicit", async () => {
		await expect(
			proposeNewBot.execute({
				name: "  Review Bot  ",
				initialProjectPath: "  /Users/me/project  ",
				reason: "  Keep reviews separate.  ",
				systemPrompt: "  Review changes carefully.  ",
			}),
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

	it("returns structured validation errors", async () => {
		await expect(proposeNewBot.execute({ name: "   " })).resolves.toEqual({
			error: "Bot name is required.",
		});
	});
});
