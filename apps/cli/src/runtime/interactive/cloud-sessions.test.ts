import type { CloudModel } from "@cline/core/cloud";
import { describe, expect, it } from "vitest";
import { isCloudSessionsEnabled, resolveCloudModel } from "./cloud-sessions";

const models: CloudModel[] = [
	{ id: "cline-pass/kimi-k3.1-pro", name: "kimi", catalogId: "cline-pass" },
	{ id: "cline-cloud/deepseek", name: "deepseek", catalogId: "cline-cloud" },
	{ id: "@preset/internal", name: "internal", catalogId: "cline" },
	{ id: "anthropic/claude-opus-5.5", name: "Opus", catalogId: "cline" },
	{ id: "anthropic/claude-sonnet-5.5", name: "Sonnet", catalogId: "cline" },
];

describe("resolveCloudModel", () => {
	it("prefers an explicit pick the catalog still offers", () => {
		expect(
			resolveCloudModel(models, {
				explicitModelId: "anthropic/claude-opus-5.5",
				localModelId: "cline-pass/kimi-k3.1-pro",
			})?.id,
		).toBe("anthropic/claude-opus-5.5");
	});

	it("falls back to the local model when the explicit pick is gone", () => {
		expect(
			resolveCloudModel(models, {
				explicitModelId: "retired/model",
				localModelId: "anthropic/claude-opus-5.5",
				localProviderId: "cline",
			})?.id,
		).toBe("anthropic/claude-opus-5.5");
	});

	it("ignores a local model from another provider even if Cloud offers the same id", () => {
		expect(
			resolveCloudModel(models, {
				localModelId: "anthropic/claude-opus-5.5",
				localProviderId: "openrouter",
			})?.id,
		).toBe("anthropic/claude-sonnet-5.5");
	});

	it("defaults ClinePass users to ClinePass", () => {
		expect(
			resolveCloudModel(models, {
				localModelId: "cline-free/not-offered",
				localProviderId: "cline-pass",
			})?.id,
		).toBe("cline-pass/kimi-k3.1-pro");
	});

	it("defaults everyone else to Cline's usage-billed default", () => {
		expect(
			resolveCloudModel(models, {
				localModelId: "claude-sonnet-4-6",
				localProviderId: "anthropic",
			})?.id,
		).toBe("anthropic/claude-sonnet-5.5");
	});
});

describe("isCloudSessionsEnabled", () => {
	it.each([
		["1", true],
		["true", true],
		["0", false],
		[undefined, false],
	])("reads CLINE_CLOUD_SESSIONS=%s", (value, expected) => {
		expect(isCloudSessionsEnabled({ CLINE_CLOUD_SESSIONS: value })).toBe(
			expected,
		);
	});
});
