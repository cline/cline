import type { DelegatedAgentRuntimeConfig } from "../teams";
import { getClineDefaultSystemPrompt } from "./cline";

export function buildTeammateSystemPrompt(
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	const trimmedPrompt = prompt.trim();
	if (config.providerId.toLowerCase() !== "cline") {
		return trimmedPrompt;
	}

	return getClineDefaultSystemPrompt(
		config.clineIdeName?.trim() || "Terminal Shell",
		config.cwd?.trim() || "/",
		config.clineWorkspaceMetadata,
		`# Team Teammate Role\n${trimmedPrompt}`,
		config.clinePlatform,
	);
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
	if (trimmedPrompt.includes("# Workspace Configuration")) {
		return trimmedPrompt;
	}

	return getClineDefaultSystemPrompt(
		"Terminal Shell",
		config.cwd?.trim() || "/",
		config.clineWorkspaceMetadata,
		trimmedPrompt,
		config.clinePlatform,
	);
}
