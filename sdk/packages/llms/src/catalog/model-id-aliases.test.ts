import { describe, expect, it } from "vitest";
import {
	isCanonicalModelIdForAliasRules,
	preferCanonicalModelIds,
	VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES,
} from "./model-id-aliases";

describe("model id aliases", () => {
	it("recognizes canonical model ids for configured alias rules", () => {
		expect(
			isCanonicalModelIdForAliasRules(
				"zai/glm-5.2",
				VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES,
			),
		).toBe(true);
		expect(
			isCanonicalModelIdForAliasRules(
				"z-ai/glm-5.2",
				VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES,
			),
		).toBe(false);
	});

	it("removes an alias only when its canonical model id exists", () => {
		const models = preferCanonicalModelIds(
			{
				"zai/glm-5.2": { source: "vercel" },
				"z-ai/glm-5.2": { source: "openrouter" },
				"z-ai/openrouter-only": { source: "openrouter" },
			},
			VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES,
		);

		expect(models).toEqual({
			"zai/glm-5.2": { source: "vercel" },
			"z-ai/openrouter-only": { source: "openrouter" },
		});
	});
});
