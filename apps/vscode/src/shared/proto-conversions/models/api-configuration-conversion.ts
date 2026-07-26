import { ModelsApiConfiguration as ProtoApiConfiguration } from "@shared/proto/cline/models"
import { type ApiConfiguration, type ApiProvider, BEDROCK_DEFAULT_MODEL_ID, BEDROCK_DEFAULT_REGION } from "../../api"

export function convertProtoToApiProvider(_provider: string | undefined): ApiProvider {
	return "bedrock"
}

export function convertApiConfigurationToProto(config: ApiConfiguration): ProtoApiConfiguration {
	return ProtoApiConfiguration.create({
		ulid: config.ulid,
		awsRegion: config.awsRegion,
		awsProfile: config.awsProfile,
		awsBedrockEndpoint: config.awsBedrockEndpoint,
		awsBedrockCaBundlePath: config.awsBedrockCaBundlePath,
		planModeApiProvider: "bedrock",
		planModeApiModelId: config.planModeApiModelId,
		planModeThinkingBudgetTokens: config.planModeThinkingBudgetTokens,
		planModeReasoningEffort: config.planModeReasoningEffort,
		actModeApiProvider: "bedrock",
		actModeApiModelId: config.actModeApiModelId,
		actModeThinkingBudgetTokens: config.actModeThinkingBudgetTokens,
		actModeReasoningEffort: config.actModeReasoningEffort,
	})
}

export function convertProtoToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	return {
		ulid: protoConfig.ulid,
		awsRegion: protoConfig.awsRegion ?? BEDROCK_DEFAULT_REGION,
		awsProfile: protoConfig.awsProfile,
		awsBedrockEndpoint: protoConfig.awsBedrockEndpoint,
		awsBedrockCaBundlePath: protoConfig.awsBedrockCaBundlePath,
		planModeApiProvider: "bedrock",
		planModeApiModelId: protoConfig.planModeApiModelId ?? BEDROCK_DEFAULT_MODEL_ID,
		planModeThinkingBudgetTokens: protoConfig.planModeThinkingBudgetTokens,
		planModeReasoningEffort: protoConfig.planModeReasoningEffort,
		actModeApiProvider: "bedrock",
		actModeApiModelId: protoConfig.actModeApiModelId ?? BEDROCK_DEFAULT_MODEL_ID,
		actModeThinkingBudgetTokens: protoConfig.actModeThinkingBudgetTokens,
		actModeReasoningEffort: protoConfig.actModeReasoningEffort,
	}
}
