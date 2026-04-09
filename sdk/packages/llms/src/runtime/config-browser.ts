import type { LlmsConfig } from "./types";

export function defineLlmsConfig(config: LlmsConfig): LlmsConfig {
	return config;
}

export async function loadLlmsConfigFromFile(): Promise<LlmsConfig> {
	throw new Error(
		"loadLlmsConfigFromFile is Node-only. Use @clinebot/llms in a Node runtime or pass a config object directly in browser runtimes.",
	);
}
