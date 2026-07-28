export type SessionHookEvent = {
	hookEventName?:
		| "tool_call"
		| "tool_result"
		| "agent_end"
		| "agent_error"
		| "session_shutdown"
		| string;
	hookName?:
		| "tool_call"
		| "tool_result"
		| "agent_end"
		| "agent_error"
		| "session_shutdown"
		| string;
	toolName?: string;
	toolInput?: unknown;
	toolOutput?: unknown;
	toolError?: string;
};

export type SessionDiffHunk = {
	/**
	 * One-based line number of the first removed line in the pre-edit file,
	 * when known. apply_patch hunks omit it because the patch format carries
	 * no line numbers, so any value would be a guess.
	 */
	oldStart?: number;
	/**
	 * One-based line number of the first added line in the post-edit file,
	 * when known.
	 */
	newStart?: number;
	old: string;
	new: string;
};

export type SessionFileDiff = {
	path: string;
	additions: number;
	deletions: number;
	hunks: SessionDiffHunk[];
};

export type SessionDiffSummary = {
	additions: number;
	deletions: number;
};

export type SessionDiffState = {
	fileDiffs: SessionFileDiff[];
	summary: SessionDiffSummary;
};

export const EMPTY_DIFF_SUMMARY: SessionDiffSummary = {
	additions: 0,
	deletions: 0,
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Tool outputs arrive in several shapes depending on the source: a plain
 * record (live hook events), a JSON-encoded string, or a list of content
 * blocks such as [{ type: "text", text: "<json>" }] (persisted history).
 */
function normalizeToolOutput(value: unknown): Record<string, unknown> | null {
	if (typeof value === "string") {
		try {
			return asRecord(JSON.parse(value));
		} catch {
			return null;
		}
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			if (typeof record.text === "string") {
				const inner = normalizeToolOutput(record.text);
				if (inner) {
					return inner;
				}
				continue;
			}
			return record;
		}
		return null;
	}
	return asRecord(value);
}

function getHookEventName(event: SessionHookEvent): string {
	return event.hookEventName ?? event.hookName ?? "";
}

function stripTrailingNewline(value: string): string {
	return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function countAddedLines(value: string | undefined): number {
	if (!value) {
		return 0;
	}
	return stripTrailingNewline(value).split("\n").length;
}

function stripApplyPatchWrapperLines(lines: string[]): string[] {
	const result: string[] = [];
	let insidePatch = false;

	for (const line of lines) {
		if (line.startsWith("*** Begin Patch")) {
			insidePatch = true;
			result.push(line);
			continue;
		}
		if (line === "*** End Patch") {
			insidePatch = false;
			result.push(line);
			continue;
		}

		const isBashWrapperLine =
			line.startsWith("%%bash") ||
			line.startsWith("apply_patch") ||
			line === "EOF" ||
			line.startsWith("```");
		if (isBashWrapperLine && !insidePatch) {
			continue;
		}

		result.push(line);
	}

	return result;
}

export function parseApplyPatchInput(input: string): SessionFileDiff[] {
	const lines = stripApplyPatchWrapperLines(
		input.split("\n").map((line) => line.replace(/\r$/, "")),
	);
	const fileDiffs: SessionFileDiff[] = [];

	let index = 0;
	const findNextActionLine = (start: number): number => {
		for (let i = start; i < lines.length; i += 1) {
			const line = lines[i] ?? "";
			if (
				line.startsWith("*** Add File: ") ||
				line.startsWith("*** Update File: ") ||
				line.startsWith("*** Delete File: ") ||
				line === "*** End Patch"
			) {
				return i;
			}
		}
		return lines.length;
	};

	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (line.startsWith("*** Add File: ")) {
			const path = line.substring("*** Add File: ".length).trim();
			const end = findNextActionLine(index + 1);
			const addedLines: string[] = [];
			for (let i = index + 1; i < end; i += 1) {
				const bodyLine = lines[i] ?? "";
				if (bodyLine.startsWith("+")) {
					addedLines.push(bodyLine.slice(1));
				}
			}
			fileDiffs.push({
				path,
				additions: addedLines.length,
				deletions: 0,
				hunks:
					addedLines.length > 0
						? [
								{
									newStart: 1,
									old: "",
									new: addedLines.join("\n"),
								},
							]
						: [],
			});
			index = end;
			continue;
		}

		if (line.startsWith("*** Delete File: ")) {
			const path = line.substring("*** Delete File: ".length).trim();
			fileDiffs.push({
				path,
				additions: 0,
				deletions: 0,
				hunks: [],
			});
			index += 1;
			continue;
		}

		if (line.startsWith("*** Update File: ")) {
			const path = line.substring("*** Update File: ".length).trim();
			const end = findNextActionLine(index + 1);

			let additions = 0;
			let deletions = 0;
			// The apply_patch format locates hunks by context, not by line
			// number, so real file positions are unknowable here. Hunks are
			// emitted without oldStart/newStart instead of fabricating them.
			let activeHunk:
				| {
						old: string[];
						new: string[];
				  }
				| undefined;
			const hunks: SessionDiffHunk[] = [];

			const flushActiveHunk = () => {
				if (!activeHunk) {
					return;
				}
				hunks.push({
					old: activeHunk.old.join("\n"),
					new: activeHunk.new.join("\n"),
				});
				activeHunk = undefined;
			};

			for (let i = index + 1; i < end; i += 1) {
				const bodyLine = lines[i] ?? "";
				if (bodyLine.startsWith("+")) {
					additions += 1;
					activeHunk ??= { old: [], new: [] };
					activeHunk.new.push(bodyLine.slice(1));
					continue;
				}
				if (bodyLine.startsWith("-")) {
					deletions += 1;
					activeHunk ??= { old: [], new: [] };
					activeHunk.old.push(bodyLine.slice(1));
					continue;
				}
				// Anything else (`@@` section markers, ` `-prefixed or bare
				// context lines, `*** End of File`) separates change runs.
				flushActiveHunk();
			}
			flushActiveHunk();

			fileDiffs.push({
				path,
				additions,
				deletions,
				hunks,
			});
			index = end;
			continue;
		}

		index += 1;
	}

	return fileDiffs;
}

function parseDiffFromEditorResult(
	resultText: string,
): Pick<SessionFileDiff, "additions" | "deletions" | "hunks"> {
	const lines = resultText.split("\n");
	const startIdx = lines.findIndex((line) => line.trim() === "```diff");
	if (startIdx < 0) {
		return { additions: 0, deletions: 0, hunks: [] };
	}
	const endIdx = lines.findIndex(
		(line, idx) => idx > startIdx && line.trim() === "```",
	);
	const body = lines.slice(
		startIdx + 1,
		endIdx > startIdx ? endIdx : undefined,
	);

	const old: string[] = [];
	const next: string[] = [];
	let additions = 0;
	let deletions = 0;
	let oldStart: number | undefined;
	let newStart: number | undefined;

	for (const raw of body) {
		const match = raw.match(/^([+-])(\d+):\s?(.*)$/);
		if (!match) {
			continue;
		}

		const op = match[1];
		const lineNo = Number.parseInt(match[2], 10);
		const text = match[3] ?? "";
		if (op === "-") {
			deletions += 1;
			old.push(text);
			oldStart = oldStart ?? lineNo;
			continue;
		}

		additions += 1;
		next.push(text);
		newStart = newStart ?? lineNo;
	}

	if (additions + deletions === 0) {
		return { additions: 0, deletions: 0, hunks: [] };
	}

	return {
		additions,
		deletions,
		hunks: [
			{
				oldStart,
				newStart,
				old: old.join("\n"),
				new: next.join("\n"),
			},
		],
	};
}

function parseEditorFileDiff(event: SessionHookEvent): SessionFileDiff | null {
	if (
		getHookEventName(event) !== "tool_result" ||
		event.toolName !== "editor" ||
		event.toolError
	) {
		return null;
	}

	const input = asRecord(event.toolInput);
	const output = normalizeToolOutput(event.toolOutput);
	if (!input || !output || output.success === false) {
		return null;
	}

	// Current editor schema has no `command` field; derive the operation from
	// the input shape (legacy `command` values still take precedence).
	const command =
		toStringValue(input.command) ??
		(input.insert_line != null
			? "insert"
			: toStringValue(input.old_text) != null
				? "str_replace"
				: "create");
	const pathFromInput = toStringValue(input.path);
	const query = toStringValue(output.query);
	const pathFromQuery = query?.includes(":")
		? query.split(":").slice(1).join(":")
		: undefined;
	const path = pathFromInput || pathFromQuery;
	if (!path) {
		return null;
	}

	const resultText = toStringValue(output.result) ?? "";

	if (command === "str_replace" && !resultText.startsWith("File created")) {
		const parsed = parseDiffFromEditorResult(resultText);
		return {
			path,
			additions: parsed.additions,
			deletions: parsed.deletions,
			hunks: parsed.hunks,
		};
	}

	if (
		command === "create" ||
		command === "insert" ||
		command === "str_replace"
	) {
		const newContent = stripTrailingNewline(
			toStringValue(input.new_text) ??
				toStringValue(input.file_text) ??
				toStringValue(input.new_str) ??
				"",
		);
		// Inserted text starts at the one-based insert_line boundary; created
		// files start at line 1.
		const insertLine =
			typeof input.insert_line === "number" ? input.insert_line : undefined;
		return {
			path,
			additions: countAddedLines(newContent),
			deletions: 0,
			hunks: newContent
				? [
						{
							newStart: command === "insert" ? insertLine : 1,
							old: "",
							new: newContent,
						},
					]
				: [],
		};
	}

	return null;
}

function parseApplyPatchFileDiffs(event: SessionHookEvent): SessionFileDiff[] {
	if (
		getHookEventName(event) !== "tool_result" ||
		event.toolName !== "apply_patch" ||
		event.toolError
	) {
		return [];
	}

	const output = normalizeToolOutput(event.toolOutput);
	if (!output || output.success === false) {
		return [];
	}

	// apply_patch accepts either { input: string } or a raw patch string.
	const patchInput =
		toStringValue(event.toolInput) ??
		toStringValue(asRecord(event.toolInput)?.input);
	if (!patchInput) {
		return [];
	}

	return parseApplyPatchInput(patchInput);
}

export function mergeToolDiffs(events: SessionHookEvent[]): SessionFileDiff[] {
	const byPath = new Map<string, SessionFileDiff>();

	for (const event of events) {
		const diffs: SessionFileDiff[] = [];
		const editorDiff = parseEditorFileDiff(event);
		if (editorDiff) {
			diffs.push(editorDiff);
		}
		diffs.push(...parseApplyPatchFileDiffs(event));
		if (diffs.length === 0) {
			continue;
		}

		for (const diff of diffs) {
			const existing = byPath.get(diff.path);
			if (!existing) {
				byPath.set(diff.path, diff);
				continue;
			}

			byPath.set(diff.path, {
				...existing,
				additions: existing.additions + diff.additions,
				deletions: existing.deletions + diff.deletions,
				hunks: [...existing.hunks, ...diff.hunks].slice(-30),
			});
		}
	}

	return Array.from(byPath.values());
}

export function summarizeFileDiffs(
	fileDiffs: SessionFileDiff[],
): SessionDiffSummary {
	return fileDiffs.reduce(
		(acc, fileDiff) => {
			acc.additions += fileDiff.additions;
			acc.deletions += fileDiff.deletions;
			return acc;
		},
		{ ...EMPTY_DIFF_SUMMARY },
	);
}

export function buildSessionDiffState(
	events: SessionHookEvent[],
): SessionDiffState {
	const fileDiffs = mergeToolDiffs(events);
	return {
		fileDiffs,
		summary: summarizeFileDiffs(fileDiffs),
	};
}
