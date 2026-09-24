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
	it.each([
		{
			name: "keeps an available local model",
			localModelId: "paid/model",
			isOrganizationSession: false,
			modelId: "paid/model",
			catalogId: "cline",
			usedFallback: false,
		},
		{
			name: "falls back to Cline Cloud before the base catalog",
			localModelId: "local-only/model",
			isOrganizationSession: false,
			modelId: "cloud/model",
			catalogId: "cline-cloud",
			usedFallback: true,
		},
		{
			name: "excludes Cline Pass for organization sessions",
			localModelId: "pass/model",
			isOrganizationSession: true,
			modelId: "cloud/model",
			catalogId: "cline-cloud",
			usedFallback: true,
		},
	])("$name", ({
		localModelId,
		isOrganizationSession,
		modelId,
		catalogId,
		usedFallback,
	}) => {
		expect(
			selectCloudHandoffModel({
				localModelId,
				models: MODELS,
				isOrganizationSession,
			}),
		).toEqual({ modelId, catalogId, usedFallback });
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
