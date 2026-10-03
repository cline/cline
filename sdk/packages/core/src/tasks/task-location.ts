import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgendaTaskScope } from "@cline/shared";

export interface AgendaTaskLocationInput {
	scope: AgendaTaskScope;
	workspaceRoot?: string;
	cwd?: string;
	resourcePaths?: readonly string[];
}

export interface NormalizedAgendaTaskLocation {
	workspaceRoot?: string;
	cwd?: string;
	resourcePaths: string[];
}

function optionalText(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return (
		rel === "" ||
		(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
	);
}

function assertNoSymlinkEscape(
	workspaceRoot: string,
	candidate: string,
	field: string,
): void {
	if (!existsSync(workspaceRoot)) return;
	const canonicalRoot = realpathSync(workspaceRoot);
	let existing = candidate;
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) break;
		existing = parent;
	}
	if (!existsSync(existing)) return;
	const canonicalExisting = realpathSync(existing);
	if (!isContained(canonicalRoot, canonicalExisting)) {
		throw new Error(`${field} escapes the workspace through a symbolic link`);
	}
}

function normalizeWorkspacePath(
	workspaceRoot: string,
	value: string,
	field: string,
	allowRoot: boolean,
): string {
	const candidate = resolve(
		workspaceRoot,
		isAbsolute(value) ? relative(workspaceRoot, value) : value,
	);
	if (
		!isContained(workspaceRoot, candidate) ||
		(!allowRoot && candidate === workspaceRoot)
	) {
		throw new Error(`${field} must stay within the task workspace`);
	}
	assertNoSymlinkEscape(workspaceRoot, candidate, field);
	return candidate;
}

/** Enforce the queue's global/chat and workspace filesystem boundaries. */
export function normalizeAgendaTaskLocation(
	input: AgendaTaskLocationInput,
): NormalizedAgendaTaskLocation {
	const rawResources = input.resourcePaths ?? [];
	if (input.scope === "global") {
		if (optionalText(input.workspaceRoot)) {
			throw new Error("global tasks cannot set workspaceRoot");
		}
		if (optionalText(input.cwd)) {
			throw new Error("global tasks cannot set cwd");
		}
		if (rawResources.some((path) => path.trim())) {
			throw new Error("global tasks cannot reference workspace files");
		}
		return { resourcePaths: [] };
	}

	const workspaceText = optionalText(input.workspaceRoot);
	if (!workspaceText) {
		throw new Error("workspaceRoot is required for workspace tasks");
	}
	const workspaceRoot = resolve(workspaceText);
	const cwdText = optionalText(input.cwd);
	const cwd = cwdText
		? normalizeWorkspacePath(workspaceRoot, cwdText, "cwd", true)
		: undefined;
	const resourcePaths: string[] = [];
	const seen = new Set<string>();
	for (const rawPath of rawResources) {
		const resourcePath = rawPath.trim();
		if (!resourcePath) {
			throw new Error("resourcePaths must contain only non-empty paths");
		}
		if (
			isAbsolute(resourcePath) ||
			resourcePath.split(/[\\/]+/u).includes("..")
		) {
			throw new Error("resourcePaths must be workspace-relative without '..'");
		}
		const candidate = normalizeWorkspacePath(
			workspaceRoot,
			resourcePath,
			"resourcePaths",
			false,
		);
		const normalized = relative(workspaceRoot, candidate);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			resourcePaths.push(normalized);
		}
	}

	return { workspaceRoot, cwd, resourcePaths };
}
