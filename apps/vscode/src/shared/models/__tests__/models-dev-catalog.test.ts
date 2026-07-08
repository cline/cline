import { describe, it } from "mocha";
import "should";
import { normalizeModelsDevProviderModels } from "../models-dev-catalog";

describe("models.dev catalog facade", () => {
	it("normalizes live models for providers that have generated fallback exports", () => {
		const providerModels = normalizeModelsDevProviderModels({
			mistral: {
				models: {
					"mistral-new": {
						name: "Mistral New",
						tool_call: true,
						release_date: "2026-04-01",
					},
				},
			},
			doubao: {
				models: {
					"doubao-new": {
						name: "Doubao New",
						tool_call: true,
						release_date: "2026-03-01",
					},
				},
			},
			"nous-research": {
				models: {
					"nous-new": {
						name: "Nous New",
						tool_call: true,
						release_date: "2026-02-01",
					},
				},
			},
		});

		Object.keys(providerModels.mistral).should.deepEqual(["mistral-new"]);
		Object.keys(providerModels.doubao).should.deepEqual(["doubao-new"]);
		Object.keys(providerModels.nousResearch).should.deepEqual(["nous-new"]);
	});

	it("sorts live models by release date before falling back to model id", () => {
		const providerModels = normalizeModelsDevProviderModels({
			anthropic: {
				models: {
					"z-old": {
						name: "Z Old",
						tool_call: true,
						release_date: "2025-01-01",
					},
					"a-new": {
						name: "A New",
						tool_call: true,
						release_date: "2026-01-01",
					},
					"b-same-date": {
						name: "B Same Date",
						tool_call: true,
						release_date: "2026-01-01",
					},
				},
			},
		});

		Object.keys(providerModels.anthropic).should.deepEqual([
			"a-new",
			"b-same-date",
			"z-old",
		]);
	});

	it("excludes deprecated models and models without tool calls", () => {
		const providerModels = normalizeModelsDevProviderModels({
			anthropic: {
				models: {
					active: {
						name: "Active",
						tool_call: true,
						status: "active",
					},
					deprecated: {
						name: "Deprecated",
						tool_call: true,
						status: "deprecated",
					},
					"no-tools": {
						name: "No Tools",
						tool_call: false,
					},
				},
			},
		});

		Object.keys(providerModels.anthropic).should.deepEqual(["active"]);
	});
});
