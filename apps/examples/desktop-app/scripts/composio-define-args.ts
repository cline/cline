/**
 * Build-time inlining of the managed Composio API key, mirroring
 * telemetry-define-args.ts. Connectors are an org-provisioned feature: the
 * key comes from CI (the COMPOSIO_API_KEY Actions secret) and must be inlined
 * into the compiled sidecar binary, because a packaged app launched from
 * Finder/the Dock has no runtime env. Builds without the secret ship with
 * connectors hidden; the key is inlined only when present, so local/dev
 * builds keep reading the live environment variable instead.
 */
export function composioDefineArgs(
	env: Record<string, string | undefined> = process.env,
): string[] {
	const apiKey = env.COMPOSIO_API_KEY?.trim();
	if (!apiKey) {
		return [];
	}
	return ["--define", `process.env.COMPOSIO_API_KEY=${JSON.stringify(apiKey)}`];
}
