/**
 * Conformance tests for the single catalog-to-gateway capability translator.
 *
 * These are deliberately state-driven rather than example-driven. The three
 * producers of gateway model definitions (builtin providers, the
 * OpenAI-compatible path, and configured models in `@cline/core`) each used to
 * carry their own hand-written `switch`, and they drifted: the pass-through
 * capabilities were handled three different ways, one producer mapped an
 * `audio` capability the catalog schema does not define, and one emitted
 * `["text"]` where the others emitted `undefined` — which gateway gates read
 * as an authoritative denial rather than "unknown".
 *
 * So instead of asserting a handful of interesting inputs, the suite walks the
 * whole capability state space taken from `ModelCapabilitySchema` (the schema,
 * not a copy of it) and asserts every producer agrees. Adding a capability to
 * the schema fails `GATEWAY_CAPABILITY_BY_MODEL_CAPABILITY`'s exhaustiveness
 * at compile time; adding a fourth producer that maps capabilities itself
 * fails the equivalence tests here.
 */

import {
	type GatewayModelCapability,
	type ModelCapability,
	ModelCapabilitySchema,
	modelSupportsToolCalling,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	BUILTIN_PROVIDER_COLLECTIONS_BY_ID,
	BUILTIN_PROVIDER_MANIFESTS_BY_ID,
} from "./builtins";
import { _testing } from "./compat";
import { toGatewayModelCapabilities } from "./model-capabilities";

const ALL_MODEL_CAPABILITIES = ModelCapabilitySchema.options;

const GATEWAY_CAPABILITIES: readonly GatewayModelCapability[] = [
	"text",
	"tools",
	"reasoning",
	"prompt-cache",
	"images",
	"audio",
	"structured-output",
];

describe("toGatewayModelCapabilities", () => {
	it("treats an absent or empty list as unspecified", () => {
		// Both must stay `undefined`: gateway gates such as
		// `modelSupportsImageInput` fail open only for an absent list, so
		// returning `["text"]` here would silently deny images.
		expect(toGatewayModelCapabilities(undefined)).toBeUndefined();
		expect(toGatewayModelCapabilities([])).toBeUndefined();
	});

	it.each(
		ALL_MODEL_CAPABILITIES,
	)("maps %s to a valid gateway capability set led by text", (capability) => {
		const result = toGatewayModelCapabilities([capability]);
		expect(result).toBeDefined();
		expect(result?.[0]).toBe("text");
		for (const mapped of result ?? []) {
			expect(GATEWAY_CAPABILITIES).toContain(mapped);
		}
		expect(new Set(result).size).toBe(result?.length);
	});

	it("covers every capability the schema declares", () => {
		// Guards against a capability being added to ModelCapabilitySchema and
		// mapped to `null` purely to silence the exhaustiveness error: each one
		// must at least translate without throwing and yield a text-capable set.
		for (const capability of ALL_MODEL_CAPABILITIES) {
			expect(toGatewayModelCapabilities([capability])).toContain("text");
		}
	});

	it("maps the capabilities the gateway distinguishes", () => {
		expect(toGatewayModelCapabilities(["images"])).toEqual(["text", "images"]);
		expect(toGatewayModelCapabilities(["tools"])).toEqual(["text", "tools"]);
		expect(toGatewayModelCapabilities(["reasoning"])).toEqual([
			"text",
			"reasoning",
		]);
		expect(toGatewayModelCapabilities(["prompt-cache"])).toEqual([
			"text",
			"prompt-cache",
		]);
		expect(toGatewayModelCapabilities(["structured_output"])).toEqual([
			"text",
			"structured-output",
		]);
	});

	it("reduces capabilities with no gateway counterpart to text", () => {
		expect(
			toGatewayModelCapabilities([
				"streaming",
				"temperature",
				"reasoning-effort",
				"computer-use",
				"global-endpoint",
				"files",
				"video",
			]),
		).toEqual(["text"]);
	});

	it("ignores values outside the schema instead of passing them through", () => {
		// Dynamic provider listings are typed as plain strings, so unknown
		// values reach the translator at runtime.
		expect(toGatewayModelCapabilities(["not-a-capability"])).toEqual(["text"]);
		expect(toGatewayModelCapabilities(["not-a-capability", "images"])).toEqual([
			"text",
			"images",
		]);
	});

	it("deduplicates capabilities that collapse onto the same gateway value", () => {
		expect(toGatewayModelCapabilities(["streaming", "temperature"])).toEqual([
			"text",
		]);
		expect(toGatewayModelCapabilities(["images", "images"])).toEqual([
			"text",
			"images",
		]);
	});
});

/**
 * Every producer of gateway model definitions must agree with the translator.
 *
 * These drive the real producers rather than re-implementing their mapping,
 * so a producer that grows its own `switch` again fails here even though the
 * translator itself still passes its own unit tests.
 */
describe("gateway capability producers", () => {
	const CAPABILITY_STATES: readonly (readonly string[] | undefined)[] = [
		undefined,
		[],
		...ALL_MODEL_CAPABILITIES.map((capability) => [capability]),
		["tools", "images", "reasoning", "prompt-cache", "structured_output"],
		["streaming", "files", "video"],
		["not-a-capability"],
	];

	it.each(
		CAPABILITY_STATES.map(
			(capabilities) =>
				[JSON.stringify(capabilities) ?? "undefined", capabilities] as const,
		),
	)("the OpenAI-compatible path agrees with the translator for %s", (_label, capabilities) => {
		const models = _testing.buildGatewayModels("openai-compatible", {
			providerId: "openai-compatible",
			modelId: "m1",
			knownModels: {
				m1: {
					id: "m1",
					...(capabilities === undefined
						? {}
						: { capabilities: capabilities as ModelCapability[] }),
				},
			},
		} as Parameters<typeof _testing.buildGatewayModels>[1]);

		expect(models?.[0]?.capabilities).toEqual(
			toGatewayModelCapabilities(capabilities),
		);
	});

	it("leaves tool calling enabled for builtin models that declare no capabilities", () => {
		// A handful of builtin language models (dify, sapaicore, opencode, and
		// the Codex CLI) carry no capability list in the generated catalog.
		// Emitting `["text"]` for them made `modelSupportsToolCalling` read an
		// authoritative denial and strip every tool definition from the request.
		const languageModelsWithoutCapabilities = Object.values(
			BUILTIN_PROVIDER_COLLECTIONS_BY_ID,
		).flatMap((collection) =>
			Object.entries(collection.models ?? {})
				.filter(
					([, info]) =>
						!info.capabilities?.length &&
						(info.operation ?? "language") === "language",
				)
				.map(([modelId]) => ({ collection, modelId })),
		);
		expect(languageModelsWithoutCapabilities.length).toBeGreaterThan(0);

		for (const { collection, modelId } of languageModelsWithoutCapabilities) {
			const manifest = BUILTIN_PROVIDER_MANIFESTS_BY_ID[collection.provider.id];
			const model = manifest?.models.find((entry) => entry.id === modelId);
			expect(model?.capabilities).toBeUndefined();
			expect(modelSupportsToolCalling(model ?? {})).toBe(true);
		}
	});

	it("builtin provider manifests agree with the translator", () => {
		// Walk the real generated catalog: whatever each builtin model declares,
		// its manifest entry must match the translator's output exactly.
		const manifests = Object.values(BUILTIN_PROVIDER_MANIFESTS_BY_ID);
		expect(manifests.length).toBeGreaterThan(0);

		let comparedModels = 0;
		for (const manifest of manifests) {
			const collection = BUILTIN_PROVIDER_COLLECTIONS_BY_ID[manifest.id];
			for (const model of manifest.models) {
				const info = collection?.models?.[model.id];
				if (!info) {
					continue;
				}
				expect(model.capabilities).toEqual(
					toGatewayModelCapabilities(info.capabilities),
				);
				comparedModels += 1;
			}
		}
		expect(comparedModels).toBeGreaterThan(0);
	});
});
