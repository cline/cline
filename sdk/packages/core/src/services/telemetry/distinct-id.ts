import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSessionDataDir } from "@clinebot/shared/storage";
import { nanoid } from "nanoid";
import { machineIdSync } from "node-machine-id";

const GENERATED_DISTINCT_ID_FILE_NAME = "machine-id";

export function resolveCoreDistinctId(explicitDistinctId?: string): string {
	const normalizedDistinctId = explicitDistinctId?.trim();
	if (normalizedDistinctId) {
		return normalizedDistinctId;
	}

	const machineDistinctId = getMachineDistinctId();
	if (machineDistinctId) {
		return machineDistinctId;
	}

	return resolveGeneratedFallbackDistinctId();
}

function getMachineDistinctId(): string | undefined {
	try {
		const distinctId = machineIdSync();
		return distinctId.trim() || undefined;
	} catch {
		return undefined;
	}
}

function resolveGeneratedFallbackDistinctId(): string {
	const sessionDataDir = resolveSessionDataDir();
	const distinctIdPath = resolve(
		sessionDataDir,
		GENERATED_DISTINCT_ID_FILE_NAME,
	);

	try {
		if (existsSync(distinctIdPath)) {
			const savedDistinctId = readFileSync(distinctIdPath, "utf8").trim();
			if (savedDistinctId.length > 0) {
				return savedDistinctId;
			}
		}
	} catch {
		// Ignore read errors and try generating a new fallback.
	}

	const generatedDistinctId = `cl-${nanoid()}`;
	try {
		mkdirSync(sessionDataDir, { recursive: true });
		writeFileSync(distinctIdPath, generatedDistinctId, "utf8");
	} catch {
		// Ignore write errors and continue with the in-memory fallback.
	}
	return generatedDistinctId;
}
