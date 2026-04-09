import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LlmsConfig } from "./types";

export function defineLlmsConfig(config: LlmsConfig): LlmsConfig {
	return config;
}

export async function loadLlmsConfigFromFile(
	configPath: string,
): Promise<LlmsConfig> {
	const resolvedPath = path.resolve(configPath);
	const raw = await readFile(resolvedPath, "utf8");

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse JSON config at "${resolvedPath}": ${details}`,
		);
	}

	return assertLlmsConfig(parsed, resolvedPath);
}

function assertLlmsConfig(value: unknown, source: string): LlmsConfig {
	if (!value || typeof value !== "object") {
		throw new Error(`Invalid llms config in "${source}": expected an object.`);
	}

	const config = value as Record<string, unknown>;
	const providers = config.providers;

	if (!Array.isArray(providers)) {
		throw new Error(
			`Invalid llms config in "${source}": "providers" must be an array.`,
		);
	}

	if (!providers.length) {
		throw new Error(
			`Invalid llms config in "${source}": "providers" cannot be empty.`,
		);
	}

	return value as LlmsConfig;
}
