import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const getLastUsedProviderConfigMock = vi.hoisted(() => vi.fn());
const generateSystemPromptFromDescriptionMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ProviderSettingsManager: class {
			getLastUsedProviderConfig = getLastUsedProviderConfigMock;
		},
		generateSystemPromptFromDescription: generateSystemPromptFromDescriptionMock,
	};
});

function createContext() {
	return {
		logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
	} as unknown as SidecarContext;
}

async function runGenerateCommand(args: Record<string, unknown>) {
	const { handleCommand } = await import("./commands");
	return handleCommand(createContext(), "generate_bot_system_prompt", args);
}

beforeEach(() => {
	getLastUsedProviderConfigMock.mockReset();
	generateSystemPromptFromDescriptionMock.mockReset();
});

describe("generate_bot_system_prompt command", () => {
	it("generates using the currently active provider, not a bot-specific one", async () => {
		const providerConfig = { providerId: "cline", modelId: "test-model" };
		getLastUsedProviderConfigMock.mockReturnValue(providerConfig);
		generateSystemPromptFromDescriptionMock.mockResolvedValue(
			"You are a helpful assistant that manages recipes.",
		);

		const result = await runGenerateCommand({
			description: "manages my recipes",
		});

		expect(generateSystemPromptFromDescriptionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				providerConfig,
				description: "manages my recipes",
			}),
		);
		expect(result).toBe("You are a helpful assistant that manages recipes.");
	});

	it("rejects an empty description without calling the model", async () => {
		await expect(runGenerateCommand({ description: "   " })).rejects.toThrow(
			"description is required",
		);
		expect(generateSystemPromptFromDescriptionMock).not.toHaveBeenCalled();
	});

	it("fails clearly when no provider is configured yet", async () => {
		getLastUsedProviderConfigMock.mockReturnValue(undefined);

		await expect(
			runGenerateCommand({ description: "manages my recipes" }),
		).rejects.toThrow("No model provider is configured yet.");
		expect(generateSystemPromptFromDescriptionMock).not.toHaveBeenCalled();
	});
});
