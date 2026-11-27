import { describe, expect, it } from "vitest";
import { normalizeClineCoreStartInput } from "./start-input";
import type { ClineCoreStartInput } from "./types";

function createInput(
	overrides: Partial<ClineCoreStartInput> = {},
): ClineCoreStartInput {
	return {
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			cwd: "/workspace",
			systemPrompt: "",
			enableTools: true,
			enableSpawnAgent: true,
			enableAgentTeams: true,
			extensionContext: {
				client: {
					name: "VSCode Extension",
					version: "3.99.0",
				},
			},
		},
		...overrides,
	};
}

describe("normalizeClineCoreStartInput", () => {
	it("keeps the additional hook directory in serialized session config", () => {
		const input = createInput();
		input.config.hooksDir = "/tmp/session-hooks";
		const normalized = normalizeClineCoreStartInput(input);
		expect(JSON.parse(JSON.stringify(normalized.config))).toHaveProperty(
			"hooksDir",
			"/tmp/session-hooks",
		);
		expect(normalized.localRuntime).not.toHaveProperty("hooksDir");
	});

	it("captures the client surface, version, and default user mode", () => {
		const normalized = normalizeClineCoreStartInput(createInput());

		expect(normalized.source).toBe("vscode");
		expect(normalized.sessionMetadata).toMatchObject({
			sessionHistoryOrigin: {
				mode: "user",
				version: "3.99.0",
			},
		});
	});

	it("keeps an explicit session mode separate from the client", () => {
		const normalized = normalizeClineCoreStartInput(
			createInput({ mode: "automation" }),
		);

		expect(normalized.source).toBe("vscode");
		expect(normalized.sessionMetadata).toMatchObject({
			sessionHistoryOrigin: {
				mode: "automation",
				version: "3.99.0",
			},
		});
	});
});
