/**
 * Configuration that can start work, before a session exists.
 *
 * A saved endpoint points at an already-known hub or Cloud sandbox. That is the
 * wrong object for Home's first message: Cloud has no sandbox until it is
 * provisioned, and a paired computer may have no inner session yet. This store
 * therefore keeps only durable *defaults* for creating work. Credentials stay in
 * the existing auth/endpoint stores.
 */

import { z } from "zod";
import { isReasoningChoice, type ReasoningChoice } from "@/session/reasoning";
export interface TargetPersistence {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	deleteItem(key: string): Promise<void>;
}

export interface CloudExecutionTarget {
	id: string;
	mode: "cloud";
	/** GitHub clone/HTML URL accepted by Cloud API's session API. */
	repoUrl: string;
	/** Human-readable owner/repository name. */
	label: string;
	modelId: string;
	reasoning?: ReasoningChoice;
	/** Branch new sessions start from. Absent = the repository default. */
	branch?: string;
	organizationId?: string;
}

const cloudModelPreferenceSchema = z.object({
	organizationId: z.string().optional(),
	modelId: z.string().trim().min(1),
});
type CloudModelPreference = z.infer<typeof cloudModelPreferenceSchema>;

type StoredCloudTarget = Omit<CloudExecutionTarget, "modelId"> & {
	readonly fallbackModelId: string;
};

function storedTarget({
	modelId,
	...target
}: CloudExecutionTarget): StoredCloudTarget {
	return { ...target, fallbackModelId: modelId };
}

interface PersistedTargets {
	cloudModelPreferences?: CloudModelPreference[];
	cloudTargets: CloudExecutionTarget[];
	lastTargetId?: string;
}

export const EXECUTION_TARGETS_STORAGE_KEY = "cline.mobile.executionTargets.v1";

export function cloudExecutionTargetId(input: {
	repoUrl: string;
	organizationId?: string;
}): string {
	return JSON.stringify([
		"cloud-target",
		input.organizationId?.trim() ?? "personal",
		input.repoUrl.trim(),
	]);
}

function isCloudExecutionTarget(value: unknown): value is CloudExecutionTarget {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return (
		row.mode === "cloud" &&
		typeof row.id === "string" &&
		row.id.length > 0 &&
		typeof row.repoUrl === "string" &&
		row.repoUrl.length > 0 &&
		typeof row.label === "string" &&
		row.label.length > 0 &&
		typeof row.modelId === "string" &&
		row.modelId.length > 0 &&
		(row.reasoning === undefined || isReasoningChoice(row.reasoning)) &&
		(row.branch === undefined || typeof row.branch === "string") &&
		(row.organizationId === undefined || typeof row.organizationId === "string")
	);
}

function parsePersistedTargets(raw: string): PersistedTargets {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { cloudTargets: [] };
		}
		const record = parsed as Record<string, unknown>;
		return {
			cloudModelPreferences: Array.isArray(record.cloudModelPreferences)
				? record.cloudModelPreferences.flatMap((value) => {
						const parsed = cloudModelPreferenceSchema.safeParse(value);
						return parsed.success ? [parsed.data] : [];
					})
				: [],
			cloudTargets: Array.isArray(record.cloudTargets)
				? record.cloudTargets.filter(isCloudExecutionTarget)
				: [],
			...(typeof record.lastTargetId === "string" && record.lastTargetId
				? { lastTargetId: record.lastTargetId }
				: {}),
		};
	} catch {
		return { cloudTargets: [] };
	}
}

export interface ExecutionTargetSnapshot {
	cloudModelPreferences: readonly CloudModelPreference[];
	cloudTargets: readonly CloudExecutionTarget[];
	lastTargetId?: string;
}

export class ExecutionTargetStore {
	private cloudModelPreferences: CloudModelPreference[] = [];
	private pendingWrite: Promise<void> = Promise.resolve();
	private cloudTargets: StoredCloudTarget[] = [];
	private lastTargetId: string | undefined;
	private readonly listeners = new Set<
		(snapshot: ExecutionTargetSnapshot) => void
	>();

	constructor(private readonly persistence?: TargetPersistence) {}

	async hydrate(): Promise<void> {
		if (!this.persistence) return;
		try {
			const raw = await this.persistence.getItem(EXECUTION_TARGETS_STORAGE_KEY);
			if (!raw) return;
			const parsed = parsePersistedTargets(raw);
			let targets = [...parsed.cloudTargets];
			this.lastTargetId = parsed.lastTargetId;
			this.cloudModelPreferences = parsed.cloudModelPreferences ?? [];
			// Older installs kept the model only on each saved repository.
			const selected = targets.find((row) => row.id === this.lastTargetId);
			if (selected)
				targets = [
					selected,
					...targets.filter((row) => row.id !== selected.id),
				];
			for (const target of targets) {
				if (
					!this.cloudModelPreferences.some(
						(row) => row.organizationId === target.organizationId,
					)
				) {
					this.cloudModelPreferences.push({
						modelId: target.modelId,
						organizationId: target.organizationId,
					});
				}
			}
			this.cloudTargets = targets.map(storedTarget);
			this.emit();
		} catch {
			// An unreadable keychain entry is treated like a clean install.
		}
	}

	get(): ExecutionTargetSnapshot {
		return {
			cloudTargets: this.cloudTargets.map((target) =>
				this.projectTarget(target),
			),
			cloudModelPreferences: [...this.cloudModelPreferences],
			...(this.lastTargetId ? { lastTargetId: this.lastTargetId } : {}),
		};
	}

	private projectTarget({
		fallbackModelId,
		...target
	}: StoredCloudTarget): CloudExecutionTarget {
		return {
			...target,
			modelId:
				this.cloudModelPreferences.find(
					(row) => row.organizationId === target.organizationId,
				)?.modelId ?? fallbackModelId,
		};
	}

	subscribe(listener: (snapshot: ExecutionTargetSnapshot) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async saveCloudTarget(
		input: Omit<CloudExecutionTarget, "id" | "mode">,
	): Promise<CloudExecutionTarget> {
		const target: CloudExecutionTarget = {
			id: cloudExecutionTargetId(input),
			mode: "cloud",
			repoUrl: input.repoUrl.trim(),
			label: input.label.trim(),
			modelId: input.modelId.trim(),
			...(input.reasoning ? { reasoning: input.reasoning } : {}),
			...(input.branch?.trim() ? { branch: input.branch.trim() } : {}),
			...(input.organizationId?.trim()
				? { organizationId: input.organizationId.trim() }
				: {}),
		};
		this.updateCloudModel(target.modelId, target.organizationId);
		const stored = storedTarget(target);
		this.cloudTargets = [
			stored,
			...this.cloudTargets.filter((row) => row.id !== target.id),
		];
		this.lastTargetId = target.id;
		this.emit();
		await this.persist();
		return this.projectTarget(stored);
	}

	async saveCloudModel(
		modelId: string,
		organizationId?: string,
	): Promise<void> {
		this.updateCloudModel(modelId.trim(), organizationId?.trim() || undefined);
		this.emit();
		await this.persist();
	}

	private updateCloudModel(modelId: string, organizationId?: string): void {
		this.cloudModelPreferences = [
			{ modelId, organizationId },
			...this.cloudModelPreferences.filter(
				(row) => row.organizationId !== organizationId,
			),
		];
	}

	async removeCloudTarget(id: string): Promise<void> {
		const next = this.cloudTargets.filter((row) => row.id !== id);
		if (next.length === this.cloudTargets.length) return;
		this.cloudTargets = next;
		if (this.lastTargetId === id) this.lastTargetId = undefined;
		this.emit();
		await this.persist();
	}

	async select(id: string): Promise<void> {
		if (this.lastTargetId === id) return;
		this.lastTargetId = id;
		const selected = this.cloudTargets.find((row) => row.id === id);
		if (selected)
			this.cloudTargets = [
				selected,
				...this.cloudTargets.filter((row) => row.id !== id),
			];
		this.emit();
		await this.persist();
	}

	private emit(): void {
		const snapshot = this.get();
		for (const listener of [...this.listeners]) {
			try {
				listener(snapshot);
			} catch {
				// A consumer fault must not prevent the selection from being saved.
			}
		}
	}

	private persist(): Promise<void> {
		const persistence = this.persistence;
		if (!persistence) return Promise.resolve();
		const serialized = JSON.stringify(this.get());
		// A slower previous write must not overwrite the latest choice.
		this.pendingWrite = this.pendingWrite
			.then(() =>
				persistence.setItem(EXECUTION_TARGETS_STORAGE_KEY, serialized),
			)
			.catch(() => {
				// The in-memory choice still works for this launch.
			});
		return this.pendingWrite;
	}
}
