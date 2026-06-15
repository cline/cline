import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

export interface GmailWorkState {
	/**
	 * Largest Gmail `internalDate` processed so far, encoded as a decimal
	 * millisecond timestamp string. Gmail documents `id` and `internalDate` as
	 * stable for a message; using `internalDate` gives a monotonic high-water mark
	 * without relying on mutable labels such as unread/read.
	 */
	maxInternalDate?: string;
	/** Message ids already processed at `maxInternalDate`. */
	seenIdsAtMaxInternalDate: string[];
}

export const EMPTY_GMAIL_WORK_STATE: GmailWorkState = {
	seenIdsAtMaxInternalDate: [],
};

export function resolveStatePath(): string {
	const explicitPath = process.env.GMAIL_WORK_STATE_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(
		resolveClineDataDir(),
		"plugins",
		"gmail-work-to-do",
		"state.json",
	);
}

function normalizeState(value: unknown): GmailWorkState {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ...EMPTY_GMAIL_WORK_STATE };
	}
	const record = value as Record<string, unknown>;
	return {
		maxInternalDate:
			typeof record.maxInternalDate === "string" &&
			record.maxInternalDate.trim()
				? record.maxInternalDate.trim()
				: undefined,
		seenIdsAtMaxInternalDate: Array.isArray(record.seenIdsAtMaxInternalDate)
			? record.seenIdsAtMaxInternalDate.filter(
					(id): id is string => typeof id === "string" && id.trim().length > 0,
				)
			: [],
	};
}

export function readState(statePath = resolveStatePath()): GmailWorkState {
	if (!existsSync(statePath)) {
		return { ...EMPTY_GMAIL_WORK_STATE };
	}
	return normalizeState(JSON.parse(readFileSync(statePath, "utf8")));
}

export function writeState(
	state: GmailWorkState,
	statePath = resolveStatePath(),
): void {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(
		statePath,
		`${JSON.stringify(normalizeState(state), null, 2)}\n`,
		"utf8",
	);
}
