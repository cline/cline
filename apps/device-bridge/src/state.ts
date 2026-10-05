import type { HubEventEnvelope } from "@cline/shared";
import {
	clip,
	type DeviceStateMessage,
	type PendingApproval,
	type PetState,
} from "./protocol";

const TOOL_LABEL_MAX = 24;
const SUMMARY_MAX = 60;
const REPLY_MAX = 80;
const ERROR_MAX = 24;
/** How long the celebration / error face stays before settling to idle. */
export const TRANSIENT_MS = 8_000;

const COMMAND_KEYS = ["command", "commands", "cmd"];
const PATH_KEYS = ["path", "file_path", "filePath", "absolutePath", "url"];

function pickString(input: unknown, keys: string[]): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value;
		if (Array.isArray(value) && typeof value[0] === "string") return value[0];
	}
	return undefined;
}

function parseInput(input: unknown): unknown {
	if (typeof input !== "string") return input;
	try {
		return JSON.parse(input);
	} catch {
		return input;
	}
}

/** Label shown under the pet while a tool runs. Bash tools show the command. */
export function toolLabel(toolName: string, input?: unknown): string {
	const command = pickString(parseInput(input), COMMAND_KEYS);
	return clip(command ?? toolName, TOOL_LABEL_MAX);
}

/** One-line summary for an approval request, e.g. "Run: bun test". */
export function approvalSummary(toolName: string, inputJson?: unknown): string {
	const input = parseInput(inputJson);
	const command = pickString(input, COMMAND_KEYS);
	if (command) return clip(`Run: ${command}`, SUMMARY_MAX);
	const path = pickString(input, PATH_KEYS);
	if (path) return clip(`${toolName}: ${path}`, SUMMARY_MAX);
	return clip(toolName, SUMMARY_MAX);
}

function lastLine(text: string): string {
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	return clip(lines.at(-1) ?? "", REPLY_MAX);
}

interface SessionView {
	running: boolean;
	tool?: string;
	updatedAt: number;
}

interface Transient {
	state: "done" | "error";
	session: string;
	reply?: string;
	err?: string;
	until: number;
}

export type VoiceOverlay =
	| { phase: "listening" }
	| {
			phase: "thinking";
			transcript?: string;
			/** Submitted to this session; clears once its turn starts. */
			awaitingSession?: string;
	  };

/**
 * Folds hub events into the single compact state the pet displays.
 * Pure apart from the injected clock, so it is unit-testable.
 */
export class PetStateProjector {
	private readonly sessions = new Map<string, SessionView>();
	private readonly approvals = new Map<
		string,
		PendingApproval & { session?: string }
	>();
	private readonly replies = new Map<string, string>();
	private transient?: Transient;
	private voice?: VoiceOverlay;
	private hubOnline = false;
	private workspace?: { path: string; at: number };
	private tasksToday = 0;
	private today = "";

	constructor(private readonly now: () => number = Date.now) {}

	setHubOnline(online: boolean): void {
		this.hubOnline = online;
		if (!online) {
			// Approvals and runs can't be trusted across a reconnect; the hub
			// re-sends anything still pending via fresh events.
			this.approvals.clear();
			for (const view of this.sessions.values()) view.running = false;
		}
	}

	setVoice(overlay: VoiceOverlay | undefined): void {
		this.voice = overlay;
	}

	/** Returns true when the event may have changed the projected state. */
	apply(event: HubEventEnvelope): boolean {
		const sessionId = event.sessionId;
		const payload = (event.payload ?? {}) as Record<string, unknown>;
		switch (event.event) {
			case "run.started":
			case "iteration.started":
				if (!sessionId) return false;
				this.touch(sessionId).running = true;
				this.clearVoiceIfAwaiting(sessionId);
				if (event.event === "run.started") this.countTask();
				return true;
			case "tool.started": {
				if (!sessionId) return false;
				const view = this.touch(sessionId);
				view.running = true;
				this.clearVoiceIfAwaiting(sessionId);
				view.tool = toolLabel(
					String(payload.toolName ?? "tool"),
					payload.input,
				);
				return true;
			}
			case "tool.finished": {
				if (!sessionId) return false;
				this.touch(sessionId).tool = undefined;
				return true;
			}
			case "assistant.finished":
				if (sessionId && typeof payload.text === "string") {
					const line = lastLine(payload.text);
					if (line) this.replies.set(sessionId, line);
				}
				return false;
			case "approval.requested": {
				const id = String(payload.approvalId ?? "");
				if (!id) return false;
				this.approvals.set(id, {
					id,
					summary: approvalSummary(
						String(payload.toolName ?? "tool"),
						payload.inputJson,
					),
					session: (payload.sessionId as string | undefined) ?? sessionId,
				});
				return true;
			}
			case "approval.resolved": {
				const id = String(payload.approvalId ?? "");
				return this.approvals.delete(id);
			}
			case "run.completed":
			case "run.aborted":
			case "run.failed":
				if (!sessionId) return false;
				return this.endRun(
					sessionId,
					event.event === "run.failed"
						? "failed"
						: event.event === "run.aborted"
							? "aborted"
							: "completed",
					payload.error ?? payload.reason,
				);
			// Turns delivered through the pending-prompt queue (follow-ups, other
			// clients) end without run.*: agent.done and the session going back to
			// a non-running status are the reliable end-of-turn signals.
			case "agent.done": {
				if (!sessionId || payload.teamAgentId) return false;
				const reason = String(payload.reason ?? "completed");
				if (typeof payload.text === "string") {
					const line = lastLine(payload.text);
					if (line) this.replies.set(sessionId, line);
				}
				return this.endRun(
					sessionId,
					reason === "aborted"
						? "aborted"
						: reason === "error" || reason === "failed"
							? "failed"
							: "completed",
					payload.error ?? reason,
				);
			}
			case "session.created":
			case "session.updated": {
				const session = payload.session as
					| { workspaceRoot?: unknown; cwd?: unknown; status?: unknown }
					| undefined;
				const path = session?.cwd ?? session?.workspaceRoot;
				if (typeof path === "string" && path) this.noteWorkspace(path);
				if (!sessionId || typeof session?.status !== "string") return false;
				const status = session.status;
				if (status === "running") {
					const view = this.touch(sessionId);
					const changed = !view.running;
					view.running = true;
					this.clearVoiceIfAwaiting(sessionId);
					return changed;
				}
				if (!this.sessions.get(sessionId)?.running) return false;
				return this.endRun(
					sessionId,
					status === "failed"
						? "failed"
						: status === "aborted"
							? "aborted"
							: "completed",
					status,
				);
			}
			case "session.detached":
				if (sessionId) this.sessions.delete(sessionId);
				return true;
			default:
				return false;
		}
	}

	/**
	 * End a session's turn. Several signals can report the same ending
	 * (agent.done, session.updated, run.completed), so a turn that is already
	 * over and already showing its result is left alone.
	 */
	private endRun(
		sessionId: string,
		outcome: "completed" | "aborted" | "failed",
		error?: unknown,
	): boolean {
		const view = this.touch(sessionId);
		const wasRunning = view.running;
		if (!wasRunning && this.transient?.session === sessionId) return false;
		view.running = false;
		view.tool = undefined;
		for (const [id, a] of this.approvals) {
			if (a.session === sessionId) this.approvals.delete(id);
		}
		if (outcome === "aborted") {
			this.replies.delete(sessionId);
			return true;
		}
		const failed = outcome === "failed";
		this.transient = {
			state: failed ? "error" : "done",
			session: sessionId,
			reply: this.replies.get(sessionId),
			err: failed ? clip(String(error ?? "error"), ERROR_MAX) : undefined,
			until: this.now() + TRANSIENT_MS,
		};
		this.replies.delete(sessionId);
		return true;
	}

	/** Record a workspace a session ran in; the newest one wins. */
	noteWorkspace(path: string, at: number = this.now()): void {
		if (!this.workspace || at >= this.workspace.at) {
			this.workspace = { path, at };
		}
	}

	/** Workspace of the most recently created/updated session, if any. */
	recentWorkspace(): string | undefined {
		return this.workspace?.path;
	}

	isRunning(sessionId: string): boolean {
		return this.sessions.get(sessionId)?.running ?? false;
	}

	/** Most recently active running session, used as the voice follow-up target. */
	activeSessionId(): string | undefined {
		let best: [string, SessionView] | undefined;
		for (const entry of this.sessions) {
			if (!entry[1].running) continue;
			if (!best || entry[1].updatedAt > best[1].updatedAt) best = entry;
		}
		if (best) return best[0];
		const pending = [...this.approvals.values()].at(-1);
		return pending?.session;
	}

	stats(): { sessions: number; today: number } {
		this.rollDay();
		const running = [...this.sessions.values()].filter((s) => s.running).length;
		return { sessions: running, today: this.tasksToday };
	}

	/** Time until the current transient face expires, if any. */
	transientRemainingMs(): number | undefined {
		if (!this.transient) return undefined;
		const left = this.transient.until - this.now();
		return left > 0 ? left : undefined;
	}

	snapshot(): DeviceStateMessage {
		if (!this.hubOnline)
			return { t: "state", state: "offline", approval: null };

		const approval = [...this.approvals.values()][0];
		if (approval) {
			return {
				t: "state",
				state: "waiting",
				session: approval.session,
				approval: { id: approval.id, summary: approval.summary },
			};
		}

		if (this.voice) {
			const state: PetState = this.voice.phase;
			return {
				t: "state",
				state,
				approval: null,
				...(this.voice.phase === "thinking" && this.voice.transcript
					? { transcript: this.voice.transcript }
					: {}),
			};
		}

		const active = this.activeSessionId();
		if (active) {
			const view = this.sessions.get(active);
			return {
				t: "state",
				state: "working",
				session: active,
				approval: null,
				...(view?.tool ? { tool: view.tool } : {}),
			};
		}

		if (this.transient && this.transient.until > this.now()) {
			const { state, session, reply, err } = this.transient;
			return {
				t: "state",
				state,
				session,
				approval: null,
				...(reply ? { reply } : {}),
				...(err ? { err } : {}),
			};
		}
		this.transient = undefined;
		return { t: "state", state: "idle", approval: null };
	}

	private clearVoiceIfAwaiting(sessionId: string): void {
		if (
			this.voice?.phase === "thinking" &&
			this.voice.awaitingSession === sessionId
		) {
			this.voice = undefined;
		}
	}

	private touch(sessionId: string): SessionView {
		let view = this.sessions.get(sessionId);
		if (!view) {
			view = { running: false, updatedAt: 0 };
			this.sessions.set(sessionId, view);
		}
		view.updatedAt = this.now();
		return view;
	}

	private rollDay(): void {
		const day = new Date(this.now()).toDateString();
		if (day !== this.today) {
			this.today = day;
			this.tasksToday = 0;
		}
	}

	private countTask(): void {
		this.rollDay();
		this.tasksToday++;
	}
}
