function serializeLogValue(value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}
	if (value === undefined) {
		return undefined;
	}
	return value;
}

type HubLogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVEL_PRIORITY: Record<HubLogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	silent: 50,
};

function resolveHubLogLevel(): HubLogLevel {
	const configured = process.env.CLINE_HUB_LOG_LEVEL?.trim().toLowerCase();
	if (
		configured === "debug" ||
		configured === "info" ||
		configured === "warn" ||
		configured === "error" ||
		configured === "silent"
	) {
		return configured;
	}
	return process.env.VITEST ? "error" : "info";
}

export function logHubMessage(
	level: "debug" | "info" | "warn" | "error",
	message: string,
	context: Record<string, unknown> = {},
): void {
	if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[resolveHubLogLevel()]) {
		return;
	}
	const payload = JSON.stringify({
		ts: new Date().toISOString(),
		level,
		component: "hub",
		message,
		...Object.fromEntries(
			Object.entries(context)
				.map(([key, value]) => [key, serializeLogValue(value)])
				.filter(([, value]) => value !== undefined),
		),
	});
	if (level === "error" || level === "warn") {
		console.error(`[hub] ${payload}`);
		return;
	}
	console.log(`[hub] ${payload}`);
}

export function logHubBoundaryError(message: string, error: unknown): void {
	const details =
		error instanceof Error ? error.stack || error.message : String(error);
	logHubMessage("error", message, { error: details });
}
