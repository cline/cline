import { basename } from "node:path";
import {
	DAY_MS,
	HISTORY_LIST_LIMIT,
	HISTORY_QUERY_MAX,
	HISTORY_SEARCH_LIMIT,
	HISTORY_SESSIONS_MAX,
	HISTORY_SNIPPET_MAX,
	HISTORY_TITLE_MAX,
	HOUR_MS,
	MINUTE_MS,
	SEARCH_TERM_MIN_LENGTH,
} from "../../config";
import { type HubFold, isRecord } from "../../hub/fold";
import { sessionRowState } from "../../model/session-rows";
import { clip } from "../redact";
import type { ContextSource, Facts, SourceEnv } from "../source";

/**
 * Session history: the person's other chats in this workspace.
 *
 * - **Reads:** `session.list` for titles and recency, and `session.search`
 *   for chats related to this turn. The hub's search ANDs every term in a
 *   query, so the source runs a few one-term searches and ranks chats by how
 *   many terms they matched.
 * - **The planner sees:** at most five chats, each as title, age, last state
 *   and one snippet, redacted and clipped. Never whole messages.
 * - **Before a chat's first turn** there is nothing to search for, so the
 *   most recent chats stand in: the welcome set's "pick up where you left
 *   off".
 */

export type HistoryLink = {
	availability(): "present" | "unknown" | "absent";
	command(
		name: string,
		payload?: Record<string, unknown>,
	): Promise<Record<string, unknown>>;
};

const STOPWORDS: ReadonlySet<string> = new Set([
	"about",
	"after",
	"also",
	"been",
	"before",
	"being",
	"could",
	"does",
	"done",
	"each",
	"file",
	"files",
	"from",
	"have",
	"into",
	"just",
	"like",
	"make",
	"more",
	"need",
	"only",
	"please",
	"should",
	"some",
	"that",
	"them",
	"then",
	"there",
	"these",
	"this",
	"those",
	"through",
	"under",
	"want",
	"were",
	"what",
	"when",
	"where",
	"which",
	"while",
	"will",
	"with",
	"would",
	"your",
]);

/** One-term queries from what the turn touched: edited files' names first, then the request's most repeated words. */
export function searchTerms(turn: SourceEnv["turn"]): string[] {
	if (!turn) return [];
	const terms: string[] = [];
	const add = (term: string) => {
		const clean = term.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "");
		if (
			clean.length >= SEARCH_TERM_MIN_LENGTH &&
			!STOPWORDS.has(clean) &&
			!terms.includes(clean)
		)
			terms.push(clean);
	};
	for (const path of turn.editedPaths) add(basename(path).split(".")[0] ?? "");
	const counts = new Map<string, number>();
	for (const word of (turn.request ?? "").split(/[^\p{L}\p{N}_-]+/u)) {
		const lower = word.toLowerCase();
		counts.set(lower, (counts.get(lower) ?? 0) + 1);
	}
	for (const [word] of [...counts.entries()].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	))
		add(word);
	return terms.slice(0, HISTORY_QUERY_MAX);
}

export type HistoryEntry = {
	sessionId: string;
	title: string;
	at?: number;
	matches: number;
	snippet?: string;
};

function listOf(
	reply: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown>[] {
	const list = reply?.[key];
	return Array.isArray(list) ? list.filter(isRecord) : [];
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Merge a `session.list` reply and one `session.search` reply per term into
 * ranked chats: this workspace only, never this chat, most terms matched
 * first, then most recent. With no searches, the most recent chats.
 */
export function rankHistory(
	listed: Record<string, unknown> | undefined,
	searches: ReadonlyArray<Record<string, unknown> | undefined>,
	env: Pick<SourceEnv, "sessionId" | "workspaceRoot">,
): HistoryEntry[] {
	const entries = new Map<string, HistoryEntry>();
	const belongs = (sessionId: string, workspaceRoot: unknown) =>
		sessionId !== env.sessionId &&
		(!env.workspaceRoot || workspaceRoot === env.workspaceRoot);
	for (const record of listOf(listed, "sessions")) {
		const sessionId = text(record.sessionId);
		if (!sessionId || !belongs(sessionId, record.workspaceRoot)) continue;
		const metadata = isRecord(record.metadata) ? record.metadata : {};
		const at =
			typeof record.updatedAt === "number" ? record.updatedAt : undefined;
		entries.set(sessionId, {
			sessionId,
			title: text(metadata.title) ?? sessionId,
			at,
			matches: 0,
		});
	}
	for (const reply of searches) {
		const counted = new Set<string>();
		for (const hit of listOf(reply, "hits")) {
			const sessionId = text(hit.sessionId);
			if (
				!sessionId ||
				counted.has(sessionId) ||
				!belongs(sessionId, hit.workspaceRoot)
			)
				continue;
			counted.add(sessionId);
			const started =
				typeof hit.startedAt === "string"
					? Date.parse(hit.startedAt)
					: Number.NaN;
			const current = entries.get(sessionId) ?? {
				sessionId,
				title: text(hit.title) ?? sessionId,
				at: Number.isFinite(started) ? started : undefined,
				matches: 0,
			};
			entries.set(sessionId, {
				...current,
				matches: current.matches + 1,
				snippet: current.snippet ?? text(hit.snippet),
			});
		}
	}
	const searched = searches.length > 0;
	return [...entries.values()]
		.filter((entry) => !searched || entry.matches > 0)
		.sort(
			(a, b) =>
				b.matches - a.matches ||
				(b.at ?? 0) - (a.at ?? 0) ||
				a.sessionId.localeCompare(b.sessionId),
		)
		.slice(0, HISTORY_SESSIONS_MAX);
}

const AGE_UNITS: ReadonlyArray<readonly [ms: number, unit: string]> = [
	[DAY_MS, "d"],
	[HOUR_MS, "h"],
	[MINUTE_MS, "m"],
];

export function ageLabel(at: number | undefined, now: number): string {
	if (at === undefined) return "age unknown";
	const elapsed = Math.max(0, now - at);
	for (const [ms, unit] of AGE_UNITS)
		if (elapsed >= ms) return `${Math.floor(elapsed / ms)}${unit} ago`;
	return "just now";
}

/** One planner line per chat: title, age, last state, one snippet. Title and snippet are the person's words, so both are redacted and clipped. */
export function historyLines(
	entries: readonly HistoryEntry[],
	fold: HubFold,
	now: number,
): string[] {
	return entries.map((entry) => {
		const session = fold.sessions[entry.sessionId];
		const state = (session && sessionRowState(session)) ?? "idle";
		const snippet = entry.snippet
			? ` · "${clip(entry.snippet.replace(/[[\]]/g, ""), HISTORY_SNIPPET_MAX)}"`
			: "";
		return `"${clip(entry.title, HISTORY_TITLE_MAX)}" · ${ageLabel(entry.at, now)} · ${state}${snippet}`;
	});
}

export function historySource(
	link: HistoryLink,
	fold: () => HubFold,
	now: () => number = Date.now,
): ContextSource {
	return {
		id: "history",
		tier: "T2",
		probe: () => link.availability(),
		async facts(env): Promise<Facts | "unknown"> {
			const terms = searchTerms(env.turn);
			const read = (name: string, payload: Record<string, unknown>) =>
				link.command(name, payload).then(
					(reply) => reply,
					() => undefined,
				);
			const [listed, ...searches] = await Promise.all([
				read("session.list", { rootOnly: true, limit: HISTORY_LIST_LIMIT }),
				...terms.map((query) =>
					read("session.search", {
						query,
						limit: HISTORY_SEARCH_LIMIT,
						workspaceRoot: env.workspaceRoot,
					}),
				),
			]);
			if (!listed && searches.every((reply) => reply === undefined))
				return "unknown";
			const entries = rankHistory(listed, searches, env);
			return {
				heading:
					terms.length > 0
						? "Related chats in this workspace"
						: "Recent chats in this workspace",
				lines: historyLines(entries, fold(), now()),
			};
		},
	};
}
