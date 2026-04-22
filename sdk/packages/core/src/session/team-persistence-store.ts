import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TeamTeammateSpec } from "@clinebot/shared";
import { resolveTeamDataDir } from "@clinebot/shared/storage";
import type { AgentTeamsRuntime, TeamEvent } from "../extensions/tools/team";
import {
	type PersistedTeamEnvelope,
	reviveTeamStateDates,
	type TeamRuntimeState,
} from "./session-row";

function sanitizeTeamName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export interface FileTeamPersistenceStoreOptions {
	teamName: string;
	baseDir?: string;
}

export class FileTeamPersistenceStore {
	private readonly dirPath: string;
	private readonly statePath: string;
	private readonly taskHistoryPath: string;
	private readonly teammateSpecs: Map<string, TeamTeammateSpec> = new Map();

	constructor(options: FileTeamPersistenceStoreOptions) {
		const safeTeamName = sanitizeTeamName(options.teamName);
		const baseDir = options.baseDir?.trim() || resolveTeamDataDir();
		this.dirPath = join(baseDir, safeTeamName);
		this.statePath = join(this.dirPath, "state.json");
		this.taskHistoryPath = join(this.dirPath, "task-history.jsonl");
	}

	loadState(): TeamRuntimeState | undefined {
		if (!existsSync(this.statePath)) {
			return undefined;
		}
		try {
			const raw = readFileSync(this.statePath, "utf8");
			const parsed = JSON.parse(raw) as PersistedTeamEnvelope;
			if (parsed.version !== 1 || !parsed.teamState) {
				return undefined;
			}
			for (const spec of parsed.teammates ?? []) {
				this.teammateSpecs.set(spec.agentId, spec);
			}
			return reviveTeamStateDates(parsed.teamState);
		} catch {
			return undefined;
		}
	}

	getTeammateSpecs(): TeamTeammateSpec[] {
		return Array.from(this.teammateSpecs.values());
	}

	upsertTeammateSpec(spec: TeamTeammateSpec): void {
		this.teammateSpecs.set(spec.agentId, spec);
	}

	removeTeammateSpec(agentId: string): void {
		this.teammateSpecs.delete(agentId);
	}

	persist(runtime: AgentTeamsRuntime): void {
		if (!this.hasPersistableState(runtime)) {
			this.clearPersistedState();
			return;
		}
		this.ensureDir();
		const envelope: PersistedTeamEnvelope = {
			version: 1,
			updatedAt: new Date().toISOString(),
			teamState: runtime.exportState(),
			teammates: Array.from(this.teammateSpecs.values()),
		};
		const tmpPath = `${this.statePath}.tmp`;
		writeFileSync(tmpPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
		renameSync(tmpPath, this.statePath);
	}

	appendTaskHistory(event: TeamEvent): void {
		let task: Record<string, unknown> = {};
		switch (event.type) {
			case "team_task_updated":
				task = event.task as unknown as Record<string, unknown>;
				break;
			case "team_message":
				task = {
					agentId: event.message.fromAgentId,
					toAgentId: event.message.toAgentId,
					subject: event.message.subject,
					taskId: event.message.taskId,
				};
				break;
			case "team_mission_log":
				task = {
					agentId: event.entry.agentId,
					kind: event.entry.kind,
					summary: event.entry.summary,
					taskId: event.entry.taskId,
				};
				break;
			case "teammate_spawned":
			case "teammate_shutdown":
			case "task_start":
				task = {
					agentId: event.agentId,
					message: "message" in event ? event.message : undefined,
				};
				break;
			case "task_end":
				task = {
					agentId: event.agentId,
					finishReason: event.result?.finishReason,
					error: event.error?.message,
				};
				break;
			case "agent_event":
				task = {
					agentId: event.agentId,
					eventType: event.event.type,
				};
				break;
		}
		this.ensureDir();
		appendFileSync(
			this.taskHistoryPath,
			`${JSON.stringify({
				ts: new Date().toISOString(),
				type: event.type,
				task,
			})}\n`,
			"utf8",
		);
	}

	private ensureDir(): void {
		if (!existsSync(this.dirPath)) {
			mkdirSync(this.dirPath, { recursive: true });
		}
	}

	private hasPersistableState(runtime: AgentTeamsRuntime): boolean {
		const state = runtime.exportState();
		if (this.teammateSpecs.size > 0) {
			return true;
		}
		if (state.members.some((member) => member.role === "teammate")) {
			return true;
		}
		return (
			state.tasks.length > 0 ||
			state.mailbox.length > 0 ||
			state.missionLog.length > 0
		);
	}

	private clearPersistedState(): void {
		if (existsSync(this.statePath)) {
			unlinkSync(this.statePath);
		}
	}
}
