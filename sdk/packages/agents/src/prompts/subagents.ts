import { buildClineSystemPrompt } from "@clinebot/shared";
import type { DelegatedAgentRuntimeConfig } from "../teams";

export function buildTeammateSystemPrompt(
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	const trimmedPrompt = prompt.trim();
	if (config.providerId.toLowerCase() !== "cline") {
		return trimmedPrompt;
	}

	return buildClineSystemPrompt({
		ide: config.clineIdeName?.trim() || "Terminal Shell",
		workspaceRoot: config.cwd?.trim() || "/",
		providerId: config.providerId,
		rules: `# Team Teammate Role\n${trimmedPrompt}`,
		platform: config.clinePlatform,
		metadata: config.workspaceMetadata,
	});
}

export function buildSubAgentSystemPrompt(
	// The prompt provided when spawning the subagent
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	const trimmedPrompt = prompt.trim();
	if (config.providerId.toLowerCase() !== "cline") {
		return trimmedPrompt;
	}

	return buildClineSystemPrompt({
		ide: "Terminal Shell",
		workspaceRoot: config.cwd?.trim() || "/",
		providerId: config.providerId,
		overridePrompt: trimmedPrompt,
		metadata: config.workspaceMetadata,
		platform: config.clinePlatform,
	});
}
