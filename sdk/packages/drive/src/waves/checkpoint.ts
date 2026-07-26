import {
	newId,
	nowIso,
	type DriveWaveCheckpoint,
	type DriveWaveCheckpointStore,
	type DriveWorkMessage,
	type DriveWorkItem,
} from "./types";

/** In-memory checkpoint store. Swap for disk/hub persistence at the host. */
export class InMemoryWaveCheckpointStore implements DriveWaveCheckpointStore {
	#byRun = new Map<string, DriveWaveCheckpoint>();

	save(checkpoint: DriveWaveCheckpoint): void {
		this.#byRun.set(checkpoint.waveRunId, structuredClone(checkpoint));
	}

	load(waveRunId: string): DriveWaveCheckpoint | null {
		const found = this.#byRun.get(waveRunId);
		return found ? structuredClone(found) : null;
	}
}

export class DriveWaveCheckpointManager {
	constructor(
		private readonly store: DriveWaveCheckpointStore = new InMemoryWaveCheckpointStore(),
	) {}

	async save(input: {
		waveRunId: string;
		wave: number;
		tasks: DriveWorkItem[];
		scratch: Record<string, unknown>;
		workMailbox: DriveWorkMessage[];
	}): Promise<DriveWaveCheckpoint> {
		const checkpoint: DriveWaveCheckpoint = {
			id: newId("wckpt"),
			waveRunId: input.waveRunId,
			wave: input.wave,
			tasks: structuredClone(input.tasks),
			scratch: structuredClone(input.scratch),
			workMailbox: structuredClone(input.workMailbox),
			createdAt: nowIso(),
		};
		await this.store.save(checkpoint);
		return checkpoint;
	}

	async load(waveRunId: string): Promise<DriveWaveCheckpoint | null> {
		return this.store.load(waveRunId);
	}
}
