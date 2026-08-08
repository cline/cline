/**
 * GitHub's remote MCP server does not support dynamic OAuth client
 * registration, so packaged desktop builds need the host application's
 * pre-registered client configuration. Finder/the Dock do not provide the
 * build environment at runtime; inline only values explicitly supplied while
 * building and leave terminal-launched binaries free to use runtime env vars.
 */
const GITHUB_OAUTH_ENV_VARS = [
	"GITHUB_OAUTH_APP_ID",
	"GITHUB_OAUTH_APP_SECRETS",
	"GITHUB_OAUTH_CALLBACK_PORT",
] as const;

export function githubOAuthDefineArgs(
	env: Record<string, string | undefined> = process.env,
): string[] {
	const args: string[] = [];
	for (const name of GITHUB_OAUTH_ENV_VARS) {
		const value = env[name];
		if (value) {
			args.push("--define", `process.env.${name}=${JSON.stringify(value)}`);
		}
	}
	return args;
}
