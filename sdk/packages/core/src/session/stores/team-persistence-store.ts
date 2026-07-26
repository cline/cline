import type { TeamTeammateSpec } from "@bedrock-coder/shared";
import type { AgentTeamsRuntime, TeamEvent } from "../../extensions/tools/team";
import {
	FileTeamStore,
	type FileTeamStoreOptions,
} from "../../services/storage/file-team-store";
import type { TeamRuntimeState } from "../models/session-row";

export interface FileTeamPersistenceStoreOptions {
	teamName: string;
	baseDir?: string;
}

/**
 * Compatibility adapter over the single local FileTeamStore implementation.
 *
 * New code should use createLocalTeamStore(); this class remains exported for
 * older embedders that persist one named team at a time.
 */
export class FileTeamPersistenceStore {
	private readonly teamName: string;
	private readonly store: FileTeamStore;
	private readonly teammateSpecs = new Map<string, TeamTeammateSpec>();

	constructor(options: FileTeamPersistenceStoreOptions) {
		this.teamName = options.teamName;
		const storeOptions: FileTeamStoreOptions = options.baseDir
			? { teamDir: options.baseDir }
			: {};
		this.store = new FileTeamStore(storeOptions);
		this.store.init();
	}

	loadState(): TeamRuntimeState | undefined {
		const loaded = this.store.loadRuntime(this.teamName);
		this.teammateSpecs.clear();
		for (const spec of loaded.teammates) {
			this.teammateSpecs.set(spec.agentId, spec);
		}
		return loaded.state;
	}

	getTeammateSpecs(): TeamTeammateSpec[] {
		return [...this.teammateSpecs.values()];
	}

	upsertTeammateSpec(spec: TeamTeammateSpec): void {
		this.teammateSpecs.set(spec.agentId, spec);
	}

	removeTeammateSpec(agentId: string): void {
		this.teammateSpecs.delete(agentId);
	}

	persist(runtime: AgentTeamsRuntime): void {
		this.store.persistRuntime(
			this.teamName,
			runtime.exportState(),
			this.getTeammateSpecs(),
		);
	}

	appendTaskHistory(event: TeamEvent): void {
		this.store.handleTeamEvent(this.teamName, event);
	}
}
