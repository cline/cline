import { useSyncExternalStore } from "react";
import { AmbiguousCloudSessionCreateError } from "@/cloud/rest/CloudSessionGateway";
import type { ConnectionDescriptor } from "@/connection";
import { cloudLaunches } from "@/connection/cloud-launches";
import { descriptorKey } from "@/connection/endpoints";
import { userErrorMessage } from "@/error-message";
import type { SessionInputAttachments } from "@/session";
import type { CloudSessionProgress } from "@/session/cloud-resolver";
import type { CloudExecutionTarget } from "./execution-target-store";

export type CloudStartJob =
	| {
			id: string;
			phase: "provisioning";
			progress?: CloudSessionProgress;
			target: CloudExecutionTarget;
			message: string;
			attachments?: SessionInputAttachments;
			createdAt: number;
	  }
	| {
			id: string;
			phase: "ready";
			target: CloudExecutionTarget;
			message: string;
			attachments?: SessionInputAttachments;
			createdAt: number;
			descriptor: ConnectionDescriptor;
			submitted?: boolean;
	  }
	| {
			id: string;
			phase: "error";
			target: CloudExecutionTarget;
			message: string;
			attachments?: SessionInputAttachments;
			createdAt: number;
			error: string;
			recovery?: "check-sessions";
	  };

type ProvisionCloud = (
	onProgress: (progress: CloudSessionProgress) => void,
) => Promise<ConnectionDescriptor>;

/** Auth failures cannot become retryable until the account state changes. */
export function isCloudStartAuthenticationError(error: string): boolean {
	const normalized = error.trim().toLowerCase();
	return (
		normalized.includes("not signed in") ||
		normalized.includes("session has expired") ||
		/\b401\b/.test(normalized)
	);
}

/**
 * Process-local background queue for Cloud provisioning. A route change must
 * not cancel a ten-minute create request, and a late completion must never
 * navigate over the session the person is currently using.
 */
export class CloudStartStore {
	private jobs: readonly CloudStartJob[] = [];
	private readonly provisioners = new Map<string, ProvisionCloud>();
	private readonly launchers = new Map<
		string,
		(descriptor: ConnectionDescriptor) => Promise<ConnectionDescriptor>
	>();
	private readonly endpoints = new Map<string, string>();
	private readonly listeners = new Set<() => void>();
	private sequence = 0;

	getSnapshot = (): readonly CloudStartJob[] => this.jobs;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	start(input: {
		target: CloudExecutionTarget;
		message: string;
		attachments?: SessionInputAttachments;
		provision: ProvisionCloud;
		launch?(descriptor: ConnectionDescriptor): Promise<ConnectionDescriptor>;
	}): string {
		const id = `cloud-start-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
		this.provisioners.set(id, input.provision);
		if (input.launch) this.launchers.set(id, input.launch);
		this.jobs = [
			...this.jobs,
			{
				id,
				phase: "provisioning",
				target: input.target,
				message: input.message,
				...(input.attachments ? { attachments: input.attachments } : {}),
				createdAt: Date.now(),
			},
		];
		this.emit();
		this.run(id);
		return id;
	}

	retry(id: string): void {
		const current = this.jobs.find((job) => job.id === id);
		if (!current || current.phase !== "error" || !this.provisioners.has(id)) {
			return;
		}
		if (current.recovery === "check-sessions") return;
		this.replace(id, { ...current, phase: "provisioning" });
		this.run(id);
	}

	remove(id: string): void {
		const next = this.jobs.filter((job) => job.id !== id);
		if (next.length === this.jobs.length) return;
		this.jobs = next;
		this.provisioners.delete(id);
		this.launchers.delete(id);
		this.endpoints.delete(id);
		this.emit();
	}

	/** Associate the receipt before exposing it in history, to prevent a second sender. */
	bindDescriptor(id: string, descriptor: ConnectionDescriptor): void {
		if (!this.jobs.some((job) => job.id === id))
			throw new Error("Cloud start cancelled.");
		this.endpoints.set(id, descriptorKey(descriptor));
	}

	jobForDescriptor(
		descriptor: ConnectionDescriptor,
	): CloudStartJob | undefined {
		const key = descriptorKey(descriptor);
		return this.jobs.find((job) => this.endpoints.get(job.id) === key);
	}

	/** Sign-out/test reset. Retire pending work and close owned viewers, without aborting remote runs. */
	clear(): void {
		this.jobs = [];
		this.provisioners.clear();
		this.launchers.clear();
		this.endpoints.clear();
		cloudLaunches.clear();
		this.emit();
	}

	private run(id: string): void {
		const provision = this.provisioners.get(id);
		if (!provision) return;
		void provision((progress) => {
			const current = this.jobs.find((job) => job.id === id);
			if (current?.phase === "provisioning")
				this.replace(id, { ...current, progress });
		})
			.then(async (descriptor) => {
				const current = this.jobs.find((job) => job.id === id);
				if (!current || current.phase !== "provisioning") return;
				const launch = this.launchers.get(id);
				const ready = launch ? await launch(descriptor) : descriptor;
				if (!this.jobs.some((job) => job.id === id)) return;
				this.replace(id, {
					...current,
					phase: "ready",
					descriptor: ready,
					...(launch ? { submitted: true } : {}),
				});
			})
			.catch((error) => {
				const current = this.jobs.find((job) => job.id === id);
				if (!current || current.phase !== "provisioning") return;
				this.replace(id, {
					...current,
					phase: "error",
					...(error instanceof AmbiguousCloudSessionCreateError
						? { recovery: "check-sessions" as const }
						: {}),
					error: userErrorMessage(
						error,
						"Cline Cloud could not start this workspace.",
					),
				});
			});
	}

	private replace(id: string, next: CloudStartJob): void {
		this.jobs = this.jobs.map((job) => (job.id === id ? next : job));
		this.emit();
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// One observer cannot stop the remaining job surfaces from updating.
			}
		}
	}
}

export const cloudStartStore = new CloudStartStore();

export function useCloudStarts(
	store: CloudStartStore = cloudStartStore,
): readonly CloudStartJob[] {
	return useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
}
