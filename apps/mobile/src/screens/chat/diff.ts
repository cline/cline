/** Small, transport-neutral diff projection for the mobile transcript. */

import { safeJsonParse } from "@cline/shared";
import {
	classifyTool,
	parseApplyPatchInput,
	parseEditorInput,
} from "@cline/ui/components/agent-chat/tool-summary";

export type DiffLineKind = "context" | "addition" | "deletion" | "header";

export interface MobileDiffLine {
	kind: DiffLineKind;
	text: string;
}

export interface MobileFileDiff {
	path: string;
	additions: number;
	deletions: number;
	lines: MobileDiffLine[];
}

export function isEditTool(name: string): boolean {
	return (
		classifyTool(name) === "edit" || name.toLowerCase() === "replace_in_file"
	);
}

/** Parse the edit payloads Cline currently emits; never guesses for other tools. */
export function parseToolDiff(
	name: string,
	input: unknown,
	output: unknown,
): MobileFileDiff[] {
	if (!isEditTool(name)) {
		return [];
	}

	const candidates = diffCandidates(input, output);
	for (const candidate of candidates) {
		if (
			candidate.includes("*** Begin Patch") ||
			candidate.includes("*** Update File:")
		) {
			const parsed = parseApplyPatch(candidate);
			if (parsed.length > 0) return parsed;
		}
		if (
			/^(?:diff --git|---\s)/m.test(candidate) &&
			/^\+\+\+\s/m.test(candidate)
		) {
			const parsed = parseUnifiedDiff(candidate);
			if (parsed.length > 0) return parsed;
		}
	}

	return projectEditorInput(input);
}

function diffCandidates(input: unknown, output: unknown): string[] {
	const values: string[] = [];
	for (const raw of [input, output]) {
		const value =
			typeof raw === "string" ? (safeJsonParse<unknown>(raw) ?? raw) : raw;
		if (typeof value === "string") {
			values.push(value);
			continue;
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const record = value as Record<string, unknown>;
		for (const key of ["patch", "diff", "input", "content", "result"]) {
			if (typeof record[key] === "string") values.push(record[key]);
		}
	}
	return values;
}

function parseApplyPatch(text: string): MobileFileDiff[] {
	return (parseApplyPatchInput(text.replace(/\r\n/g, "\n"))?.files ?? []).map(
		(file) => ({
			path: file.movedTo ?? file.path,
			additions: file.additions,
			deletions: file.deletions,
			lines: [
				...(file.movedTo
					? [
							{
								kind: "header" as const,
								text: `${file.path} → ${file.movedTo}`,
							},
						]
					: []),
				...(parseUnifiedDiff(file.diff)[0]?.lines ?? []),
			],
		}),
	);
}

// Shared helpers generate unified diffs, but do not parse arbitrary git-diff
// output. This adapter only projects those lines into native renderer rows.
function parseUnifiedDiff(text: string): MobileFileDiff[] {
	const files: MobileFileDiff[] = [];
	let current: MobileFileDiff | undefined;
	let pendingOldPath: string | undefined;
	for (const raw of text.split(/\r?\n/)) {
		if (raw.startsWith("diff --git ")) {
			const match = raw.match(/^diff --git a\/(.+) b\/(.+)$/);
			current = {
				path: match?.[2] ?? "Unknown file",
				additions: 0,
				deletions: 0,
				lines: [],
			};
			files.push(current);
			pendingOldPath = undefined;
			continue;
		}
		if (raw.startsWith("--- ")) {
			pendingOldPath = cleanDiffPath(raw.slice(4));
			continue;
		}
		if (raw.startsWith("+++ ")) {
			const path = cleanDiffPath(raw.slice(4));
			if (!current || (current.lines.length > 0 && current.path !== path)) {
				current = {
					path:
						path === "/dev/null" ? (pendingOldPath ?? "Deleted file") : path,
					additions: 0,
					deletions: 0,
					lines: [],
				};
				files.push(current);
			} else if (path !== "/dev/null") {
				current.path = path;
			}
			continue;
		}
		if (!current) continue;
		if (raw.startsWith("@@")) {
			current.lines.push({ kind: "header", text: raw });
		} else if (raw.startsWith("+")) {
			current.additions += 1;
			current.lines.push({ kind: "addition", text: raw.slice(1) });
		} else if (raw.startsWith("-")) {
			current.deletions += 1;
			current.lines.push({ kind: "deletion", text: raw.slice(1) });
		} else if (raw.startsWith(" ")) {
			current.lines.push({ kind: "context", text: raw.slice(1) });
		}
	}
	return files.filter(
		(file) => file.lines.length > 0 || file.additions + file.deletions > 0,
	);
}

function cleanDiffPath(value: string): string {
	const path = value.split("\t", 1)[0]?.trim() ?? value.trim();
	return path.replace(/^[ab]\//, "");
}

/** Preserve legacy mobile/archived field names at the shared-parser boundary. */
export function normalizeEditorInput(
	input: unknown,
): Record<string, unknown> | undefined {
	const value =
		typeof input === "string" ? safeJsonParse<unknown>(input) : input;
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const record = value as Record<string, unknown>;
	const path = [
		record.path,
		record.file,
		record.filePath,
		record.file_path,
	].find(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	const next = [
		record.new_text,
		record.newText,
		record.new_str,
		record.file_text,
	].find((value): value is string => typeof value === "string");
	const old = [record.old_text, record.oldText, record.old_str].find(
		(value): value is string => typeof value === "string",
	);
	return {
		...record,
		path,
		old_text: old,
		new_text: next ?? (old !== undefined ? "" : undefined),
	};
}

function projectEditorInput(input: unknown): MobileFileDiff[] {
	const info = parseEditorInput(normalizeEditorInput(input));
	if (!info) return [];
	// Keep this linear projection: the web helper's full LCS diff is quadratic
	// for large replacements, before our native preview limit can take effect.
	const oldLines =
		info.oldText === undefined ? [] : splitContentLines(info.oldText);
	const nextLines = splitContentLines(info.newText);
	const lines: MobileDiffLine[] = [
		...oldLines.map((text) => ({ kind: "deletion" as const, text })),
		...nextLines.map((text) => ({ kind: "addition" as const, text })),
	];
	return [
		{
			path: info.path,
			additions: nextLines.length,
			deletions: oldLines.length,
			lines,
		},
	];
}

function splitContentLines(value: string): string[] {
	if (value.length === 0) return [];
	const lines = value.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	return lines;
}
