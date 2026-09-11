import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSessionDataDir } from "@cline/shared/storage";
import { nanoid } from "nanoid";
import * as nodeMachineId from "node-machine-id";

const GENERATED_DISTINCT_ID_FILE_NAME = "machine-id";

let cachedMachineId: string | undefined;
let machineIdProbed = false;

export function resolveCoreDeviceId(): string {
	// Only the machine id is cached: it is environment-independent and probing
	// it shells out to the OS. The generated fallback is re-resolved on every
	// call because it lives under the data dir, which can change at runtime
	if (!machineIdProbed) {
		cachedMachineId = getMachineDistinctId();
		machineIdProbed = true;
	}
	return cachedMachineId ?? resolveGeneratedFallbackDistinctId();
}

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

function resolveMachineIdSync(): ((original?: boolean) => string) | undefined {
	const module = nodeMachineId as typeof nodeMachineId & {
		default?: typeof nodeMachineId;
	};
	return module.machineIdSync ?? module.default?.machineIdSync;
}

function getMachineDistinctId(): string | undefined {
	try {
		const machineIdSync = resolveMachineIdSync();
		if (!machineIdSync) {
			return undefined;
		}
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
