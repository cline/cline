import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";

export function resolveAiSdkTemperature(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): number | undefined {
	return context.model.metadata?.supportsTemperature === false
		? undefined
		: request.temperature;
}
