export function formatCloudCredential(accessToken: string): string {
	return accessToken.startsWith("workos:")
		? accessToken
		: `workos:${accessToken}`;
}
