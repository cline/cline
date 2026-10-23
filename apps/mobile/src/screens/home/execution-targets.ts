import { type ConnectionDescriptor, descriptorKey } from "@/connection";
import type { CloudExecutionTarget } from "@/state/execution-target-store";
import type { SessionRow } from "./session-rows";

export type HomeExecutionTarget =
	| {
			id: string;
			mode: "local";
			title: string;
			detail: string;
			descriptor: ConnectionDescriptor;
	  }
	| {
			id: string;
			mode: "local-session";
			title: string;
			detail: string;
			descriptor: ConnectionDescriptor;
	  }
	| {
			id: string;
			mode: "cloud";
			title: string;
			detail: string;
			cloud: CloudExecutionTarget;
	  }
	| {
			id: string;
			mode: "cloud-session";
			title: string;
			detail: string;
			descriptor: ConnectionDescriptor;
	  };

/** Build runnable destinations independently of whether a transcript exists. */
export function buildHomeExecutionTargets(input: {
	endpoints: readonly ConnectionDescriptor[];
	cloudTargets: readonly CloudExecutionTarget[];
	sessionRows?: readonly SessionRow[];
	unavailableLocalMachineIds?: readonly string[];
}): readonly HomeExecutionTarget[] {
	const result: HomeExecutionTarget[] = [];
	const seenLocal = new Set<string>();
	const unavailableLocal = new Set(input.unavailableLocalMachineIds ?? []);
	for (const endpoint of input.endpoints) {
		if (endpoint.mode !== "local") continue;
		const machineId = endpoint.relayMachineId ?? endpoint.url;
		const machineKey = JSON.stringify(["local-target", machineId]);
		if (seenLocal.has(machineKey)) continue;
		seenLocal.add(machineKey);
		const descriptor: ConnectionDescriptor = { ...endpoint };
		delete descriptor.hubSessionId;
		delete descriptor.sessionTitle;
		result.push({
			id: machineKey,
			mode: "local",
			title: endpoint.label?.trim() || "My computer",
			detail: unavailableLocal.has(machineId)
				? "Can't reach Cline right now"
				: "New Cline session on this computer",
			descriptor,
		});
	}

	for (const cloud of input.cloudTargets) {
		result.push({
			id: cloud.id,
			mode: "cloud",
			title: cloud.label,
			detail: cloud.branch
				? `New Cline Cloud workspace · ${cloud.branch}`
				: "New Cline Cloud workspace",
			cloud,
		});
	}

	// Existing work is runnable too. Unlike machine/repository targets, selecting
	// these rows resumes the exact inner session named by the descriptor.
	for (const row of input.sessionRows ?? []) {
		if (row.kind !== "session") continue;
		if (row.descriptor.mode === "local") {
			result.push({
				id: `local-session-target:${descriptorKey(row.descriptor)}`,
				mode: "local-session",
				title: row.title,
				detail: `Existing Cline session · ${row.location.name}`,
				descriptor: row.descriptor,
			});
		} else {
			result.push({
				id: `cloud-session-target:${descriptorKey(row.descriptor)}`,
				mode: "cloud-session",
				title: row.title,
				detail: "Existing Cline Cloud workspace",
				descriptor: row.descriptor,
			});
		}
	}
	return result;
}

export function targetLocation(target: HomeExecutionTarget): string {
	return target.mode === "local" || target.mode === "local-session"
		? "My computer"
		: "Cline Cloud";
}

/** Machine/repository launchers create work; session rows resume exact work. */
export function targetCreatesNewSession(target: HomeExecutionTarget): boolean {
	return target.mode === "local";
}
