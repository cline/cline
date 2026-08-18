import { describe, expect, it } from "vitest";
import {
	type CloudHandoffModel,
	selectCloudHandoffModel,
} from "./model-selection";

const MODELS: CloudHandoffModel[] = [
	{ id: "paid/model", name: "Paid Model", catalogId: "cline" },
	{ id: "pass/model", name: "Pass Model", catalogId: "cline-pass" },
	{ id: "cloud/model", name: "Cloud Model", catalogId: "cline-cloud" },
];

describe("selectCloudHandoffModel", () => {
	it("keeps an available local model", () => {
		expect(
			selectCloudHandoffModel({
				localModelId: "paid/model",
				models: MODELS,
			}),
		).toEqual({
			modelId: "paid/model",
			catalogId: "cline",
			usedFallback: false,
		});
	});

	it("falls back to Cline Cloud before the base catalog", () => {
		expect(
			selectCloudHandoffModel({
				localModelId: "local-only/model",
				models: MODELS,
			}),
		).toEqual({
			modelId: "cloud/model",
			catalogId: "cline-cloud",
			usedFallback: true,
		});
	});

	it("excludes Cline Pass for organization sessions", () => {
		expect(
			selectCloudHandoffModel({
				localModelId: "pass/model",
				models: MODELS,
				isOrganizationSession: true,
			}),
		).toEqual({
			modelId: "cloud/model",
			catalogId: "cline-cloud",
			usedFallback: true,
		});
	});

	it("fails when no eligible models are supplied", () => {
		expect(() =>
			selectCloudHandoffModel({
				models: [MODELS[1]],
				isOrganizationSession: true,
			}),
		).toThrow("No cloud models");
	});
});
