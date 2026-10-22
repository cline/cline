export type ClineIntegration = {
	provider?: string;
	created_at?: string;
};

export type ClineGitHubRepository = {
	id?: number;
	name?: string;
	full_name?: string;
	html_url?: string;
	private?: boolean;
};

export const GITHUB_INTEGRATION_PROVIDER = "github";

export function findGitHubIntegration(
	integrations: ClineIntegration[],
): ClineIntegration | undefined {
	return integrations.find(
		(integration) => integration?.provider === GITHUB_INTEGRATION_PROVIDER,
	);
}
