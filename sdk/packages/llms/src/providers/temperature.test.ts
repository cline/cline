import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { resolveAiSdkTemperature } from "./temperature";

describe("AI SDK temperature routing", () => {
	const request = { temperature: 0.7 } as GatewayStreamRequest;

	it("omits temperature for models that explicitly do not support it", () => {
		expect(
			resolveAiSdkTemperature(request, contextWithTemperatureSupport(false)),
		).toBeUndefined();
	});

	it("preserves temperature for models that support it", () => {
		expect(
			resolveAiSdkTemperature(request, contextWithTemperatureSupport(true)),
		).toBe(0.7);
	});

	it("preserves temperature when dynamic model capabilities are unknown", () => {
		expect(
			resolveAiSdkTemperature(request, contextWithTemperatureSupport()),
		).toBe(0.7);
	});
});

function contextWithTemperatureSupport(
	supportsTemperature?: boolean,
): GatewayProviderContext {
	return {
		model: {
			id: "claude-sonnet-5",
			name: "Claude Sonnet 5",
			providerId: "bedrock",
			metadata:
				supportsTemperature === undefined ? undefined : { supportsTemperature },
		},
	} as GatewayProviderContext;
}
