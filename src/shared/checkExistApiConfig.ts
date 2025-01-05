import { ApiConfiguration } from "../shared/api";

export function checkExistKey(config: ApiConfiguration | undefined) {
	return config
		? [
			config.apiKey,
			config.openRouterApiKey,
			config.awsRegion,
			config.vertexProjectId,
			config.openAiApiKey,
			config.ollamaModelId,
			config.lmStudioModelId,
			config.geminiApiKey,
			config.openAiNativeApiKey,
			config.deepSeekApiKey,
		].some((key) => key !== undefined)
		: false;
}
