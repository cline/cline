import type {
	GatewayProviderContext,
	GatewayProviderMetadata,
} from "@cline/shared";
import { providerReasoningRouteMatches } from "../model-facts";

/**
 * MiMo reasoning-effort routing.
 *
 * Xiaomi's MiMo thinking strengths on the OpenAI-compatible
 * `/chat/completions` wire are spelled `low` | `medium` | `high` | `extra`
 * (the top level is `extra`). The portable AI SDK reasoning vocabulary only
 * has `minimal` | `low` | `medium` | `high` | `xhigh`, and
 * `@ai-sdk/openai-compatible` copies that level verbatim into
 * `reasoning_effort`, so an "Extra" selection reaches Xiaomi as
 * `reasoning_effort: "xhigh"` and the request is rejected with "Invalid
 * request parameters".
 *
 * The translation runs at the request-body seam because the portable
 * top-level `reasoning` option is composed outside the provider-option rule
 * table and bypasses catalog effort normalization entirely (see
 * `resolvePortableReasoning` / `withoutPortableReasoning`). Values outside
 * the known dialect pass through unchanged so custom gateways keep their
 * exact current wire format.
 */

export const MIMO_REASONING_EFFORT_ROUTING_METADATA: GatewayProviderMetadata = {
	routing: {
		reasoning: {
			format: "mimo-reasoning-effort",
			routes: [{ matcher: "model-family", family: "mimo" }],
		},
	},
};

const MIMO_REASONING_EFFORT_WIRE_VALUES: Readonly<
	Record<string, string | undefined>
> = {
	// MiMo's thinking strengths have no "minimal" tier; keep requests valid
	// by dropping to the lightest advertised level.
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	// The portable "extra high" levels are MiMo's top "extra" strength.
	xhigh: "extra",
	max: "extra",
};

export function toMimoReasoningEffortWireValue(value: string): string {
	return MIMO_REASONING_EFFORT_WIRE_VALUES[value] ?? value;
}

export function mapMimoReasoningEffortInRequestBody(
	body: Record<string, unknown>,
	context: GatewayProviderContext,
): Record<string, unknown> {
	const modelId = typeof body.model === "string" ? body.model : "";
	if (
		!providerReasoningRouteMatches(
			"mimo-reasoning-effort",
			{ modelId },
			context,
		)
	) {
		return body;
	}

	const effort = body.reasoning_effort;
	if (typeof effort !== "string") {
		return body;
	}

	const mappedEffort = toMimoReasoningEffortWireValue(effort);
	return mappedEffort === effort
		? body
		: { ...body, reasoning_effort: mappedEffort };
}
