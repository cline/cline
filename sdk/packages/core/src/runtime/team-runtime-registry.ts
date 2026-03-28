import type {
	AgentTeamsRuntime,
	DelegatedAgentConfigProvider,
} from "@clinebot/agents";

export interface TeamRuntimeRegistryEntry {
	runtime?: AgentTeamsRuntime;
	delegatedAgentConfigProvider: DelegatedAgentConfigProvider;
}

export class TeamRuntimeRegistry {
	private readonly entries = new Map<string, TeamRuntimeRegistryEntry>();

	get(key: string): TeamRuntimeRegistryEntry | undefined {
		return this.entries.get(key);
	}

	getOrCreate(
		key: string,
		create: () => TeamRuntimeRegistryEntry,
	): TeamRuntimeRegistryEntry {
		const existing = this.entries.get(key);
		if (existing) {
			return existing;
		}
		const created = create();
		this.entries.set(key, created);
		return created;
	}

	update(
		key: string,
		updateEntry: (entry: TeamRuntimeRegistryEntry) => void,
	): TeamRuntimeRegistryEntry | undefined {
		const entry = this.entries.get(key);
		if (!entry) {
			return undefined;
		}
		updateEntry(entry);
		return entry;
	}

	delete(key: string): void {
		this.entries.delete(key);
	}
}
