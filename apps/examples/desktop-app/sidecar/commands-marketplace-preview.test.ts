import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

const previewService = vi.hoisted(() => ({
	getMarketplaceSkillPreview: vi.fn(),
	readMarketplaceSkillFile: vi.fn(),
}));

vi.mock("./marketplace-skill-preview", () => previewService);

const entry = { id: "amplify-workflow", type: "skill" };
const routes = [
	{
		command: "get_marketplace_skill_preview",
		service: "getMarketplaceSkillPreview",
		args: { entry },
		result: {
			files: [{ path: "SKILL.md", size: 15 }],
			defaultPath: "SKILL.md",
			sourceUrl:
				"https://github.com/cline/skills/tree/HEAD/skills/amplify-workflow",
		},
	},
	{
		command: "read_marketplace_skill_file",
		service: "readMarketplaceSkillFile",
		args: { entry, path: "SKILL.md" },
		result: {
			path: "SKILL.md",
			content: "# Skill preview",
			sourceUrl:
				"https://github.com/cline/skills/blob/HEAD/skills/amplify-workflow/SKILL.md",
		},
	},
] as const;

beforeEach(() => {
	vi.resetAllMocks();
});

describe("desktop marketplace preview commands", () => {
	it.each(
		routes,
	)("routes $command through the desktop command handler", async ({
		command,
		service,
		args,
		result,
	}) => {
		previewService[service].mockResolvedValueOnce(result);

		await expect(
			handleCommand({} as SidecarContext, command, args),
		).resolves.toEqual(result);
		expect(previewService[service]).toHaveBeenCalledExactlyOnceWith(args);
		const otherService =
			service === "getMarketplaceSkillPreview"
				? "readMarketplaceSkillFile"
				: "getMarketplaceSkillPreview";
		expect(previewService[otherService]).not.toHaveBeenCalled();
	});

	it.each(routes)("preserves service failures from $command", async ({
		command,
		service,
		args,
	}) => {
		const error = new Error("Skill source is unavailable");
		previewService[service].mockRejectedValueOnce(error);

		await expect(
			handleCommand({} as SidecarContext, command, args),
		).rejects.toBe(error);
		expect(previewService[service]).toHaveBeenCalledExactlyOnceWith(args);
	});
});
