import { describe, expect, it } from "vitest";
import { enableManagedClineLangfuseTelemetry } from "./provider-telemetry";
import type { ClineCoreStartInput } from "./types";

function createInput(providerId = "cline"): ClineCoreStartInput {
	return {
		config: {
			providerId,
			modelId: `${providerId}/model`,
			cwd: "/tmp/workspace",
			workspaceRoot: "/tmp/workspace",
			systemPrompt: "test",
			mode: "act",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
		prompt: "hello",
		interactive: false,
	};
}

describe("enableManagedClineLangfuseTelemetry", () => {
	it("adds only managed enablement for Cline and ClinePass providers", () => {
		for (const providerId of ["cline", "cline-pass"]) {
			const input = createInput(providerId);
			input.config.compaction = {
				summarizer: {
					providerId,
					modelId: `${providerId}/summary-model`,
				},
			};

			const result = enableManagedClineLangfuseTelemetry(input, true);

			expect(result.config.providerConfig).toMatchObject({
				providerId,
				modelId: `${providerId}/model`,
				managedTelemetry: { langfuse: true },
			});
			expect(
				result.config.compaction?.summarizer?.providerConfig,
			).toMatchObject({
				providerId,
				modelId: `${providerId}/summary-model`,
				managedTelemetry: { langfuse: true },
			});
			expect(JSON.stringify(result)).not.toContain("publicKey");
			expect(JSON.stringify(result)).not.toContain("secretKey");
		}
	});

	it("preserves existing provider telemetry switches", () => {
		const input = createInput();
		input.config.providerConfig = {
			providerId: "cline",
			modelId: "cline/model",
			managedTelemetry: { langfuse: false },
		};

		const result = enableManagedClineLangfuseTelemetry(input, true);

		expect(result.config.providerConfig?.managedTelemetry).toEqual({
			langfuse: true,
		});
		expect(input.config.providerConfig.managedTelemetry).toEqual({
			langfuse: false,
		});
	});

	it("does not modify third-party providers or disabled sessions", () => {
		const thirdParty = createInput("openrouter");
		expect(enableManagedClineLangfuseTelemetry(thirdParty, true)).toBe(
			thirdParty,
		);

		const cline = createInput("cline");
		expect(enableManagedClineLangfuseTelemetry(cline, false)).toBe(cline);
	});
});
