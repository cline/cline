import type { BasicLogger } from "@cline/core";

export function logCliError(
	logger: BasicLogger | undefined,
	message: string,
	metadata: Record<string, unknown> & { error?: unknown } = {},
): void {
	if (logger?.error) {
		logger.error(message, metadata);
		return;
	}
	logger?.log(message, {
		...metadata,
		severity: "error",
	});
}

export async function logCliProcessError(
	kind: string,
	error: unknown,
): Promise<void> {
	try {
		const { createCliLoggerAdapter, flushCliLoggerAdapters } = await import(
			"./adapter"
		);
		const logger = createCliLoggerAdapter({
			runtime: "cli",
			component: "process",
		});
		logCliError(logger.core, "CLI process error", { kind, error });
		flushCliLoggerAdapters();
	} catch {
		// Process-level logging is best-effort; stderr still gets the error.
	}
}
