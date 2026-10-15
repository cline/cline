import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TeamRuntimeState, TeamTeammateSpec } from "@cline/shared";
import { resolveTeamDataDir } from "@cline/shared/storage";
import type { TeamEvent } from "../../extensions/tools/team";
import {
	isDurableTeamEvent,
	toPersistableTeamEvent,
	toTeamRunResultRecord,
} from "../../extensions/tools/team/persistence-policy";
import { sanitizeTeamName } from "../../extensions/tools/team/sanitize-team-name";
import type { TeamPersistenceBatch, TeamStore } from "../../types/storage";
import { TEAM_EVENT_RETENTION_PER_TEAM } from "./sqlite-team-store";

/** Compact `task-history.jsonl` once it grows past this size. */
const FILE_HISTORY_COMPACT_BYTES = 4 * 1024 * 1024;

function nowIso(): string {
	return new Date().toISOString();
}

function reviveTeamRuntimeStateDates(
	state: TeamRuntimeState,
): TeamRuntimeState {
	return {
		...state,
		tasks: state.tasks.map((task) => ({
			...task,
			createdAt: new Date(task.createdAt),
			updatedAt: new Date(task.updatedAt),
		})),
		mailbox: state.mailbox.map((message) => ({
			...message,
			sentAt: new Date(message.sentAt),
			readAt: message.readAt ? new Date(message.readAt) : undefined,
		})),
		missionLog: state.missionLog.map((entry) => ({
			...entry,
			ts: new Date(entry.ts),
		})),
		runs: (state.runs ?? []).map((run) => ({
			...run,
			startedAt: new Date(run.startedAt),
			endedAt: run.endedAt ? new Date(run.endedAt) : undefined,
			nextAttemptAt: run.nextAttemptAt
				? new Date(run.nextAttemptAt)
				: undefined,
			heartbeatAt: run.heartbeatAt ? new Date(run.heartbeatAt) : undefined,
			lastProgressAt: run.lastProgressAt
				? new Date(run.lastProgressAt)
				: undefined,
		})),
		outcomes: (state.outcomes ?? []).map((outcome) => ({
			...outcome,
			createdAt: new Date(outcome.createdAt),
			finalizedAt: outcome.finalizedAt
				? new Date(outcome.finalizedAt)
				: undefined,
		})),
		outcomeFragments: (state.outcomeFragments ?? []).map((fragment) => ({
			...fragment,
			createdAt: new Date(fragment.createdAt),
			reviewedAt: fragment.reviewedAt
				? new Date(fragment.reviewedAt)
				: undefined,
		})),
	};
}

interface PersistedTeamEnvelope {
	version: 1;
	updatedAt: string;
	teamState: TeamRuntimeState;
	teammates: TeamTeammateSpec[];
}

export interface FileTeamStoreOptions {
	teamDir?: string;
}

export interface TeamRuntimeLoadResult {
	state?: TeamRuntimeState;
	teammates: TeamTeammateSpec[];
	interruptedRunIds: string[];
}

export class FileTeamStore implements TeamStore {
	private readonly teamDirPath: string;

	constructor(options: FileTeamStoreOptions = {}) {
		this.teamDirPath = options.teamDir ?? resolveTeamDataDir();
	}

	init(): void {
		this.ensureTeamDir();
	}

	listTeamNames(): string[] {
		if (!existsSync(this.teamDirPath)) {
			return [];
		}
		return readdirSync(this.teamDirPath, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.filter((entry) => existsSync(this.statePath(entry.name)))
			.map((entry) => entry.name)
			.sort();
	}

	readState(teamName: string): TeamRuntimeState | undefined {
		const envelope = this.readEnvelope(teamName);
		return envelope?.teamState
			? reviveTeamRuntimeStateDates(envelope.teamState)
			: undefined;
	}

	readHistory(teamName: string, limit = 200): unknown[] {
		const historyPath = this.historyPath(teamName);
		if (!existsSync(historyPath)) {
			return [];
		}
		return readFileSync(historyPath, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line) as unknown;
				} catch {
					return undefined;
				}
			})
			.filter((item): item is unknown => item !== undefined)
			.reverse()
			.slice(0, limit);
	}

	loadRuntime(teamName: string): TeamRuntimeLoadResult {
		const envelope = this.readEnvelope(teamName);
		return {
			state: envelope?.teamState
				? reviveTeamRuntimeStateDates(envelope.teamState)
				: undefined,
			teammates: envelope?.teammates ?? [],
			interruptedRunIds: [],
		};
	}

	handleTeamEvent(teamName: string, event: TeamEvent): void {
		if (!isDurableTeamEvent(event)) {
			return;
		}
		this.appendHistory(teamName, [
			{ type: event.type, payload: toPersistableTeamEvent(event) },
		]);
	}

	/**
	 * The file store cannot apply deltas, so it rewrites `state.json` once per
	 * batch. Batching plus compacted run results keep that file small.
	 */
	persistBatch(teamName: string, batch: TeamPersistenceBatch): void {
		// State first: rewriting it is idempotent, so if the history append then
		// fails the writer's retry re-sends both without duplicating history.
		this.persistRuntime(teamName, batch.getFullState(), batch.teammates);
		if (batch.events.length > 0) {
			this.appendHistory(teamName, batch.events);
		}
	}

	private appendHistory(
		teamName: string,
		events: Array<{ type: string; payload: unknown }>,
	): void {
		this.ensureTeamSubdir(teamName);
		const ts = nowIso();
		const path = this.historyPath(teamName);
		appendFileSync(
			path,
			events
				.map(
					(e) =>
						`${JSON.stringify({ ts, eventType: e.type, payload: e.payload })}\n`,
				)
				.join(""),
			"utf8",
		);
		// Events are on disk; compaction is best-effort and must not make the
		// caller retry (and re-append) them.
		try {
			this.compactHistoryIfNeeded(path);
		} catch {
			// Retried on the next append.
		}
	}

	/** Keep the newest `retentionPerTeam` lines once the file grows too big. */
	private compactHistoryIfNeeded(path: string): void {
		let size = 0;
		try {
			size = statSync(path).size;
		} catch {
			return;
		}
		if (size < FILE_HISTORY_COMPACT_BYTES) {
			return;
		}
		const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
		// Bound by count and bytes: keep at most half the trigger size so the
		// next compaction is far away even when individual events are large.
		const kept: string[] = [];
		let bytes = 0;
		for (
			let i = lines.length - 1;
			i >= 0 && kept.length < TEAM_EVENT_RETENTION_PER_TEAM;
			i--
		) {
			const line = lines[i] as string;
			bytes += Buffer.byteLength(line, "utf8") + 1;
			if (bytes > FILE_HISTORY_COMPACT_BYTES / 2 && kept.length > 0) break;
			kept.push(line);
		}
		kept.reverse();
		const tempPath = `${path}.tmp`;
		writeFileSync(tempPath, `${kept.join("\n")}\n`, "utf8");
		renameSync(tempPath, path);
	}

	persistRuntime(
		teamName: string,
		state: TeamRuntimeState,
		teammates: TeamTeammateSpec[],
	): void {
		this.ensureTeamSubdir(teamName);
		const envelope: PersistedTeamEnvelope = {
			version: 1,
			updatedAt: nowIso(),
			teamState: {
				...state,
				runs: state.runs.map((run) => ({
					...run,
					result: toTeamRunResultRecord(run.result),
				})),
			},
			teammates,
		};
		const path = this.statePath(teamName);
		const tempPath = `${path}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
		renameSync(tempPath, path);
	}

	markInProgressRunsInterrupted(teamName: string, reason: string): string[] {
		const envelope = this.readEnvelope(teamName);
		if (!envelope?.teamState?.runs?.length) {
			return [];
		}
		const interrupted = envelope.teamState.runs
			.filter((run) => run.status === "queued" || run.status === "running")
			.map((run) => run.id);
		if (interrupted.length === 0) {
			return [];
		}
		const endedAt = new Date();
		envelope.teamState = {
			...envelope.teamState,
			runs: envelope.teamState.runs.map((run) =>
				run.status === "queued" || run.status === "running"
					? {
							...run,
							status: "interrupted",
							error: reason,
							endedAt,
						}
					: run,
			),
		};
		this.persistRuntime(teamName, envelope.teamState, envelope.teammates);
		return interrupted;
	}

	private ensureTeamDir(): string {
		if (!existsSync(this.teamDirPath)) {
			mkdirSync(this.teamDirPath, { recursive: true });
		}
		return this.teamDirPath;
	}

	private ensureTeamSubdir(teamName: string): string {
		const path = join(this.ensureTeamDir(), sanitizeTeamName(teamName));
		if (!existsSync(path)) {
			mkdirSync(path, { recursive: true });
		}
		return path;
	}

	private statePath(teamName: string): string {
		return join(this.ensureTeamDir(), sanitizeTeamName(teamName), "state.json");
	}

	private historyPath(teamName: string): string {
		return join(
			this.ensureTeamDir(),
			sanitizeTeamName(teamName),
			"task-history.jsonl",
		);
	}

	private readEnvelope(teamName: string): PersistedTeamEnvelope | undefined {
		const path = this.statePath(teamName);
		if (!existsSync(path)) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(
				readFileSync(path, "utf8"),
			) as PersistedTeamEnvelope;
			if (parsed?.version === 1 && parsed.teamState) {
				return parsed;
			}
		} catch {
			// Ignore invalid persistence and fall back to undefined.
		}
		return undefined;
	}
}
