export function logHubBoundaryError(message: string, error: unknown): void {
	const details =
		error instanceof Error ? error.stack || error.message : String(error);
	console.error(`[hub] ${message}: ${details}`);
}
