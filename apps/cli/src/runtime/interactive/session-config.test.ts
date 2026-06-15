import { describe, expect, it } from "vitest";
import type { Config } from "../../utils/types";
import { buildInteractiveSessionConfig } from "./session-config";

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		providerId: "anthropic",
		modelId: "anthropic/claude-sonnet-4.6",
		apiKey: "key",
		systemPrompt: "test",
		cwd: process.cwd(),
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		defaultToolAutoApprove: false,
		toolPolicies: {},
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		...overrides,
	};
}

function buildConfig(config: Config): Config {
	return buildInteractiveSessionConfig({
		config,
		chatCommandState: {
			enableTools: true,
			autoApproveTools: false,
			cwd: config.cwd,
			workspaceRoot: config.workspaceRoot ?? config.cwd,
		},
		runtimeHooks: {},
		onTeamEvent: () => {},
		resolveMistakeLimitDecision: undefined,
	});
}

describe("buildInteractiveSessionConfig agent profile restrictions", () => {
	it("derives tool and skill restrictions from the active profile", () => {
		const built = buildConfig(
			makeConfig({
				agentProfile: {
					name: "reviewer",
					systemPrompt: "You are a reviewer.",
					tools: ["read_files"],
					skills: ["review-pr"],
				},
			}),
		);

		expect(built.skills).toEqual(["review-pr"]);
		expect(built.disabledToolNames).toContain("run_commands");
		expect(built.disabledToolNames).not.toContain("read_files");
		// Implied by the profile's skills field.
		expect(built.disabledToolNames).not.toContain("skills");
	});

	it("clears the restrictions when no profile is active", () => {
		const built = buildConfig(
			makeConfig({
				agentProfile: undefined,
				// Stale values from a previous profile must not survive a rebuild.
				disabledToolNames: ["run_commands"],
				skills: ["review-pr"],
			}),
		);

		expect(built.disabledToolNames).toBeUndefined();
		expect(built.skills).toBeUndefined();
	});

	it("leaves tools unrestricted for a profile without a tools field", () => {
		const built = buildConfig(
			makeConfig({
				agentProfile: {
					name: "reviewer",
					systemPrompt: "You are a reviewer.",
				},
			}),
		);

		expect(built.disabledToolNames).toBeUndefined();
		expect(built.skills).toBeUndefined();
	});
});
