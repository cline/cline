import { AdaptiveConcurrency } from "./adaptiveConcurrency";
import { DriveWaveCheckpointManager } from "./checkpoint";
import { DriveWaveExecutor } from "./waveExecutor";
import { alwaysContinueReview } from "./reviewGates";
import { DriveWorkMailbox } from "./workMailbox";
import { DriveWorkScratch } from "./workScratch";
import { TokenQueue } from "./tokenQueue";
import {
	createDriveWaveResult,
	createWorkItem,
	newId,
	nowIso,
	type DriveReviewGate,
	type DriveWaveLogEntry,
	type DriveWaveResult,
	type DriveWaveRunnerOptions,
	type DriveWorkItem,
	type DriveWorkInput,
} from "./types";

function hasPendingWork(tasks: readonly DriveWorkItem[]): boolean {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	return tasks.some((task) => {
		if (task.status !== "pending") {
			return false;
		}
		return task.dependsOn.every((depId) => byId.get(depId)?.status === "succeeded");
	});
}

/**
 * Multi-wave Drive runner for parallel room work.
 * Initialize scratch → review gates → parallel batch → spawn/inject → checkpoint → repeat.
 */
export class DriveWaveRunner {
	readonly waveRunId: string;
	readonly scratch = new DriveWorkScratch();
	readonly workMailbox = new DriveWorkMailbox();
	readonly logs: DriveWaveLogEntry[] = [];
	#tasks: DriveWorkItem[] = [];
	#wave = 0;
	#concurrency: AdaptiveConcurrency;
	#tokenQueue: TokenQueue;
	#gates: DriveReviewGate[];
	#checkpoint: DriveWaveCheckpointManager;
	#options: DriveWaveRunnerOptions;

	constructor(options: DriveWaveRunnerOptions) {
		this.#options = options;
		this.waveRunId = options.waveRunId ?? newId("wave");
		this.#concurrency = new AdaptiveConcurrency(options.concurrency);
		this.#tokenQueue = new TokenQueue(options.tokenQueue);
		this.#gates =
			options.gates && options.gates.length > 0
				? options.gates
				: [alwaysContinueReview];
		this.#checkpoint = new DriveWaveCheckpointManager(options.checkpointStore);
	}

	get tasks(): readonly DriveWorkItem[] {
		return this.#tasks;
	}

	get wave(): number {
		return this.#wave;
	}

	enqueue(inputs: DriveWorkInput[]): DriveWorkItem[] {
		const created = inputs.map((input) => createWorkItem(input));
		this.#tasks.push(...created);
		return created;
	}

	async resumeFromCheckpoint(): Promise<boolean> {
		const checkpoint = await this.#checkpoint.load(this.waveRunId);
		if (!checkpoint) {
			return false;
		}
		this.#tasks = checkpoint.tasks;
		this.#wave = checkpoint.wave;
		this.scratch.restore(checkpoint.scratch);
		this.workMailbox.restore(checkpoint.workMailbox);
		this.logs.push({
			at: nowIso(),
			level: "info",
			message: `resumed from checkpoint ${checkpoint.id}`,
			data: { wave: checkpoint.wave },
		});
		return true;
	}

	async run(initial: DriveWorkInput[] = []): Promise<DriveWaveResult> {
		try {
			if (initial.length > 0) {
				this.enqueue(initial);
			}

			const maxWaves = this.#options.maxWaves ?? 32;
			const executor = new DriveWaveExecutor({
				host: this.#options.host,
				concurrency: this.#concurrency,
				tokenQueue: this.#tokenQueue,
				scratch: this.scratch,
				workMailbox: this.workMailbox,
				gates: this.#gates,
				logs: this.logs,
				signal: this.#options.signal,
			});

			while (hasPendingWork(this.#tasks)) {
				if (this.#options.signal?.aborted) {
					return this.#finish("aborted", "wave aborted by signal");
				}
				if (this.#wave >= maxWaves) {
					return this.#finish(
						"failure",
						`exceeded maxWaves=${maxWaves} with pending work remaining`,
					);
				}

				this.#wave += 1;
				const waveResult = await executor.runWave({
					wave: this.#wave,
					tasks: this.#tasks,
				});
				this.#tasks = waveResult.tasks;

				await this.#checkpoint.save({
					waveRunId: this.waveRunId,
					wave: this.#wave,
					tasks: this.#tasks,
					scratch: this.scratch.toRecord(),
					workMailbox: this.workMailbox.snapshot(),
				});

				switch (waveResult.gate.action) {
					case "continue":
					case "inject":
					case "redirect":
						break;
					case "pause":
						return this.#finish(
							"paused",
							waveResult.gate.reason ?? "paused by gate",
						);
					case "abort":
						return this.#finish(
							"aborted",
							waveResult.gate.reason ?? "aborted by gate",
						);
					default: {
						const _exhaustive: never = waveResult.gate.action;
						return _exhaustive;
					}
				}
			}

			const failed = this.#tasks.filter((task) => task.status === "failed");
			if (failed.length === 0) {
				return this.#finish("success", "wave completed");
			}
			const succeeded = this.#tasks.some((task) => task.status === "succeeded");
			if (succeeded) {
				return this.#finish(
					"partial",
					`${failed.length} task(s) failed; others succeeded`,
				);
			}
			return this.#finish("failure", "all executed tasks failed");
		} finally {
			this.#tokenQueue.close();
		}
	}

	#finish(
		status: DriveWaveResult["status"],
		message: string,
	): DriveWaveResult {
		const errors = this.#tasks
			.filter((task) => task.status === "failed" && task.error)
			.map((task) => `${task.id}: ${task.error}`);
		return createDriveWaveResult({
			status,
			waveRunId: this.waveRunId,
			wave: this.#wave,
			tasks: this.#tasks,
			logs: this.logs,
			errors,
			metadata: {
				concurrencyWindow: this.#concurrency.window,
				scratchKeys: Object.keys(this.scratch.toRecord()),
				workMailboxSize: this.workMailbox.messages.length,
			},
			message,
		});
	}
}
