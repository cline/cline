import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../utils/types";

vi.mock("../runtime/prompt", () => ({
	resolveSystemPrompt: vi.fn().mockResolvedValue("system prompt"),
}));

const { AcpAgent } = await import("./acpAgent");

type AgentWithConfig = {
	buildConfig(session: unknown): Promise<Config>;
};

function buildConfig(
	options?: ConstructorParameters<typeof AcpAgent>[1],
): Promise<Config> {
	const agent = new AcpAgent({} as AgentSideConnection, options);
	return (agent as unknown as AgentWithConfig).buildConfig({
		cwd: process.cwd(),
		currentMode: "act",
		currentProviderId: "anthropic",
		currentModelId: "claude-sonnet",
		autoApproveTools: false,
	});
}

describe("ACP reasoning", () => {
	it("applies the reasoning resolved from --thinking", async () => {
		const config = await buildConfig({
			reasoning: { thinking: true, reasoningEffort: "high" },
		});

		expect(config.thinking).toBe(true);
		expect(config.reasoningEffort).toBe("high");
	});

	it("keeps reasoning off when --thinking is not given", async () => {
		const config = await buildConfig();

		expect(config.thinking).toBe(false);
		expect(config.reasoningEffort).toBeUndefined();
	});
});
