import { buildClineSystemPrompt } from "@cline/shared";
import type { DelegatedAgentRuntimeConfig } from "./delegated-agent";

export function buildTeammateSystemPrompt(
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	const trimmedPrompt = prompt.trim();
	return buildClineSystemPrompt({
		ide: config.clineIdeName?.trim() || "Terminal",
		workspaceRoot: config.cwd?.trim() || "/",
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
	return buildClineSystemPrompt({
		ide: config.clineIdeName || "Terminal",
		workspaceRoot: config.cwd?.trim() || "/",
		overridePrompt: trimmedPrompt,
		metadata: config.workspaceMetadata,
		platform: config.clinePlatform,
	});
}
