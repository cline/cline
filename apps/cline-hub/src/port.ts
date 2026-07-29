import net from "node:net";

function isAddressInUseError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as Error & { code?: string }).code === "EADDRINUSE"
	);
}

/**
 * Prefer `preferred`, then fall back to an ephemeral free port when that bind
 * fails with EADDRINUSE. Callers that received an explicit user port should not
 * use this — they should fail closed instead of silently relocating.
 */
export async function resolveAvailablePort(
	host: string,
	preferred: number,
): Promise<number> {
	const tryListen = (port: number) =>
		new Promise<number>((resolve, reject) => {
			const probe = net.createServer();
			probe.unref();
			probe.once("error", reject);
			probe.listen(port, host, () => {
				const address = probe.address();
				probe.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					if (!address || typeof address === "string") {
						reject(new Error("Failed to resolve free port"));
						return;
					}
					resolve(address.port);
				});
			});
		});

	try {
		return await tryListen(preferred);
	} catch (error) {
		if (!isAddressInUseError(error)) throw error;
		return await tryListen(0);
	}
}
