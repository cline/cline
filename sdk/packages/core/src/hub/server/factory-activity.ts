import {
	type AgendaTaskRecord,
	formatFactoryId,
	type HubFactoryActivityPayload,
	type HubFactoryActivityRole,
} from "@cline/shared";
import type { CoreSessionEvent } from "../../types/events";

/** At most one event per session in this window; the latest start is sent after it. */
export const FACTORY_ACTIVITY_INTERVAL_MS = 400;
const TEXT_CHARS = 120;

/** Identity a Factory role session carries in its metadata. */
export interface FactoryActivitySession {
	taskId: string;
	role: "designer" | "builder" | "verifier" | "reviewer";
}

export interface FactoryActivityPublisherOptions {
	/** Resolves a Factory role session, or undefined for any other session. */
	resolveSession: (
		sessionId: string,
	) => Promise<FactoryActivitySession | undefined>;
	/** The card, read to tell a plan reviewer from the designer. */
	getTask: (
		taskId: string,
	) => Promise<AgendaTaskRecord | undefined> | AgendaTaskRecord | undefined;
	publish: (payload: HubFactoryActivityPayload) => void;
	onError?: (error: unknown) => void;
	intervalMs?: number;
	now?: () => number;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function first(value: unknown): unknown {
	return Array.isArray(value) ? value[0] : value;
}

/** Long tokens, credentials in assignments and auth flags are elided. */
function redact(text: string): string {
	return text
		.replace(
			/\b([A-Za-z0-9_]*(?:token|key|secret|password|passwd|auth)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi,
			"$1=…",
		)
		.replace(/(--?(?:token|password|key|secret|auth)[\s=])(\S+)/gi, "$1…")
		.replace(/(bearer\s+)\S+/gi, "$1…")
		.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, "…");
}

function bound(text: string, chars = TEXT_CHARS): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > chars ? `${line.slice(0, chars - 1)}…` : line;
}

/** The last segments of a path; worktree prefixes say nothing. */
function shortPath(path: string): string {
	const parts = path.split(/[\\/]+/).filter(Boolean);
	const short =
		path.startsWith("/") || /^[A-Za-z]:/.test(path)
			? parts.slice(-3).join("/")
			: parts.join("/");
	return bound(short || path);
}

function pathOf(input: Record<string, unknown>): string | undefined {
	for (const key of ["path", "file_path", "files", "paths", "file_paths"]) {
		const value = first(input[key]);
		const path =
			typeof value === "string" ? value : (record(value)?.path ?? undefined);
		if (typeof path === "string" && path.trim()) return shortPath(path);
	}
	for (const key of ["input", "patch"]) {
		const patch = input[key];
		if (typeof patch !== "string") continue;
		const match = /\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(patch);
		if (match?.[1]) return shortPath(match[1].trim());
	}
	return undefined;
}

function commandOf(input: Record<string, unknown>): string | undefined {
	for (const key of ["commands", "command", "cmd"]) {
		const value = first(input[key]);
		const command =
			typeof value === "string" ? value : (record(value)?.command ?? undefined);
		if (typeof command === "string" && command.trim())
			return bound(redact(command), 80);
	}
	return undefined;
}

function queryOf(input: Record<string, unknown>): string | undefined {
	for (const key of ["queries", "query", "pattern", "skill", "url"]) {
		const value = first(input[key]);
		if (typeof value === "string" && value.trim())
			return bound(redact(value), 80);
	}
	return undefined;
}

/**
 * A short, safe view of a tool call: one path, the head of one command or
 * one query, each redacted and bounded. Never file contents or patches.
 */
export function summarizeFactoryToolInput(
	toolName: string,
	rawInput: unknown,
): { input?: HubFactoryActivityPayload["input"]; summary: string } {
	const input = record(rawInput) ?? {};
	const path = toolName === "run_commands" ? undefined : pathOf(input);
	const command =
		toolName === "run_commands" || (!path && toolName.includes("command"))
			? commandOf(input)
			: undefined;
	const query = path || command ? undefined : queryOf(input);
	const safe = {
		...(path ? { path } : {}),
		...(command ? { command } : {}),
		...(query ? { query } : {}),
	};
	let summary: string;
	if (toolName === "read_files" && path) summary = `Reading ${path}`;
	else if ((toolName === "editor" || toolName === "apply_patch") && path)
		summary = `Editing ${path}`;
	else if (command) summary = `Running ${command}`;
	else if (toolName === "search_codebase" && query)
		summary = `Searching for ${query}`;
	else if (toolName === "skills" && query) summary = `Using skill ${query}`;
	else if (toolName === "fetch_web_content") summary = "Reading a web page";
	else if (toolName === "ask_question") summary = "Asking a question";
	else if (toolName === "submit_and_exit") summary = "Submitting its result";
	else if (path) summary = `${bound(toolName, 40)} ${path}`;
	else summary = `Using ${bound(toolName, 40)}`;
	return {
		...(Object.keys(safe).length ? { input: safe } : {}),
		summary: bound(summary),
	};
}

/**
 * Publishes `task.factory.activity` for each tool start of a Factory role
 * session. Session identity is resolved once per session; events are
 * throttled per session (the latest start in a window is sent at its end);
 * publishing never blocks or fails the session.
 */
export class FactoryActivityPublisher {
	private readonly sessions = new Map<
		string,
		Promise<FactoryActivitySession | undefined>
	>();
	private readonly lastSent = new Map<string, number>();
	private readonly pending = new Map<
		string,
		{ payload: HubFactoryActivityPayload; timer: ReturnType<typeof setTimeout> }
	>();
	private readonly intervalMs: number;
	private readonly now: () => number;

	constructor(private readonly options: FactoryActivityPublisherOptions) {
		this.intervalMs = options.intervalMs ?? FACTORY_ACTIVITY_INTERVAL_MS;
		this.now = options.now ?? Date.now;
	}

	/** Feed every session event; only tool starts and session ends matter. */
	handle(event: CoreSessionEvent): void {
		if (event.type === "ended") {
			this.forget(event.payload.sessionId);
			return;
		}
		if (event.type !== "agent_event") return;
		const agentEvent = event.payload.event;
		if (
			agentEvent.type !== "content_start" ||
			agentEvent.contentType !== "tool" ||
			typeof agentEvent.toolName !== "string"
		)
			return;
		const { sessionId } = event.payload;
		const toolName = agentEvent.toolName;
		const input = agentEvent.input;
		const at = this.now();
		void this.resolve(sessionId)
			.then((session) => {
				if (session) this.offer(sessionId, session, toolName, input, at);
			})
			.catch((error) => this.options.onError?.(error));
	}

	dispose(): void {
		for (const { timer } of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
		this.sessions.clear();
		this.lastSent.clear();
	}

	private resolve(sessionId: string) {
		let session = this.sessions.get(sessionId);
		if (!session) {
			session = this.options.resolveSession(sessionId).catch((error) => {
				this.sessions.delete(sessionId);
				throw error;
			});
			this.sessions.set(sessionId, session);
		}
		return session;
	}

	private forget(sessionId: string): void {
		const pending = this.pending.get(sessionId);
		if (pending) clearTimeout(pending.timer);
		this.pending.delete(sessionId);
		this.sessions.delete(sessionId);
		this.lastSent.delete(sessionId);
	}

	private offer(
		sessionId: string,
		session: FactoryActivitySession,
		toolName: string,
		rawInput: unknown,
		at: number,
	): void {
		const { input, summary } = summarizeFactoryToolInput(toolName, rawInput);
		const payload: HubFactoryActivityPayload = {
			taskId: session.taskId,
			sessionId,
			role: session.role,
			toolName: bound(toolName, 80),
			...(input ? { input } : {}),
			summary,
			at: new Date(at).toISOString(),
		};
		const wait = (this.lastSent.get(sessionId) ?? -Infinity) + this.intervalMs;
		const now = this.now();
		const queued = this.pending.get(sessionId);
		if (queued) {
			queued.payload = payload;
			return;
		}
		if (now >= wait) {
			this.send(payload, now);
			return;
		}
		const timer = setTimeout(() => {
			const latest = this.pending.get(sessionId);
			this.pending.delete(sessionId);
			if (latest) this.send(latest.payload, this.now());
		}, wait - now);
		(timer as { unref?: () => void }).unref?.();
		this.pending.set(sessionId, { payload, timer });
	}

	private send(payload: HubFactoryActivityPayload, now: number): void {
		this.lastSent.set(payload.sessionId, now);
		void this.annotate(payload)
			.then((annotated) => this.options.publish(annotated))
			.catch((error) => this.options.onError?.(error));
	}

	/**
	 * Adds the card's short id, and tells a plan reviewer from the designer: a
	 * designer-role session listed among the card's plan reviewers reviews the plan.
	 */
	private async annotate(
		payload: HubFactoryActivityPayload,
	): Promise<HubFactoryActivityPayload> {
		const task = await this.options.getTask(payload.taskId);
		const factoryId = task?.factoryNumber
			? formatFactoryId(task.factoryNumber)
			: undefined;
		const progress = task?.factoryDesignProgress;
		const role: HubFactoryActivityRole =
			payload.role === "designer" &&
			progress &&
			progress.phase !== "designing" &&
			progress.designerSessionId !== payload.sessionId &&
			progress.reviewerSessions.some(
				(entry) => entry.sessionId === payload.sessionId,
			)
				? "plan_reviewer"
				: payload.role;
		return { ...payload, role, ...(factoryId ? { factoryId } : {}) };
	}
}
