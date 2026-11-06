import * as os from "node:os";
import type { RuntimeEnv } from "@cline/shared";
import { displayName, version } from "../../package.json";

export function parsePositiveInteger(value: string): number | undefined {
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) {
		return undefined;
	}
	const parsed = Number(trimmed);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		return undefined;
	}
	return parsed;
}

export function getCliBuildInfo(): RuntimeEnv {
	return {
		name: displayName,
		version,
		platform: "terminal",
		platform_version: process.version,
		os_type: os.platform(),
		os_version: os.version(),
	};
}
