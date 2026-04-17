import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveRpcProtoPath(importMetaUrl: string): string {
	const candidates = buildCandidates(dirname(fileURLToPath(importMetaUrl)));

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error("Unable to resolve rpc.proto path");
}

function findWorkspaceRoot(start: string): string | null {
	let cursor = start;
	while (true) {
		if (existsSync(join(cursor, "bun.lock"))) {
			return cursor;
		}
		const parent = dirname(cursor);
		if (parent === cursor) break;
		cursor = parent;
	}
	return null;
}

function buildCandidates(runtimeDir: string): string[] {
	const candidates: string[] = [];

	// Find monorepo root and use workspace-aware path
	const workspaceRoot = findWorkspaceRoot(runtimeDir);
	if (workspaceRoot) {
		candidates.push(
			join(workspaceRoot, "packages", "rpc", "src", "proto", "rpc.proto"),
		);
	}

	return candidates;
}
