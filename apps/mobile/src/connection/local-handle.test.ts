import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildLocalCreateSessionInput } from "./local-handle";

describe("buildLocalCreateSessionInput", () => {
	it("uses production Cline defaults and lets the hub resolve its workspace", () => {
		expect(buildLocalCreateSessionInput({ url: "ws://localhost/hub" })).toEqual(
			{
				sessionConfig: {
					providerId: "cline",
					modelId: CLINE_DEFAULT_MODEL_ID,
					systemPrompt: expect.stringContaining("You are Cline"),
					mode: "act",
					enableTools: true,
					checkpoint: { enabled: true },
					compaction: { enabled: true },
				},
				metadata: { source: "core", interactive: true },
				runtimeOptions: {
					clientContributions: [
						{
							kind: "toolExecutor",
							executor: "askQuestion",
							capabilityName: "tool_executor.askQuestion",
						},
					],
				},
			},
		);
	});

	it("uses the full Cline prompt rather than a mobile placeholder", () => {
		const input = buildLocalCreateSessionInput({
			url: "ws://localhost/hub",
			workspaceRoot: "/repo",
		});
		const prompt = (input.sessionConfig as { systemPrompt: string })
			.systemPrompt;
		expect(prompt).toContain("You are Cline");
		expect(prompt).toContain("/repo");
		expect(prompt).not.toBe("cline-mobile");
	});

	it("passes an explicitly selected workspace and model through", () => {
		expect(
			buildLocalCreateSessionInput({
				url: "ws://localhost/hub",
				workspaceRoot: "/repo",
				providerId: "anthropic",
				modelId: "claude-test",
			}),
		).toMatchObject({
			workspaceRoot: "/repo",
			cwd: "/repo",
			sessionConfig: {
				providerId: "anthropic",
				modelId: "claude-test",
				workspaceRoot: "/repo",
				cwd: "/repo",
			},
		});
	});
});
