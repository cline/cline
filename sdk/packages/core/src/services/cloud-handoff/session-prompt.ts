export const CLOUD_HANDOFF_WORKSPACE_ROOT = "/workspace";

export const CLOUD_GITHUB_AUTH_SYSTEM_PROMPT =
	"IMPORTANT: GitHub API authentication is handled automatically by the infrastructure. " +
	"A secrets-proxy sidecar injects the necessary authentication credentials into all GitHub API requests. " +
	"You do NOT need to set up, configure, or manage any authentication tokens, API keys, or credentials for GitHub API calls. " +
	"Simply make your GitHub API calls normally — authentication will be injected transparently.";

export function buildCloudHandoffNotice(input: {
	repoUrl: string;
	branch: string;
	workspaceRoot?: string;
}): string {
	const workspaceRoot =
		input.workspaceRoot?.trim() || CLOUD_HANDOFF_WORKSPACE_ROOT;
	return (
		`This session was handed off from a local workspace. The cloud runtime is Linux, and the repository is now a fresh clone of ${input.repoUrl}@${input.branch} at ${workspaceRoot}. ` +
		"Statements earlier in the transcript about the prior OS, absolute paths, environment, and tool availability describe the old local runtime and are stale."
	);
}

export function buildCloudHandoffSystemPrompt(input: {
	repoUrl: string;
	branch: string;
	workspaceRoot?: string;
}): string {
	return `${CLOUD_GITHUB_AUTH_SYSTEM_PROMPT}\n\n${buildCloudHandoffNotice(input)}`;
}
