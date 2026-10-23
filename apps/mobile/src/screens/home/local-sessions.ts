import { localModelOptions } from "./local-models";
import { HubClient } from "@cline/hub-client";
import { useCallback, useEffect, useState } from "react";
import type { CloudModelOption } from "@/cloud";
import { cloudAuthStore } from "@/cloud";
import { type ConnectionDescriptor, resolveLocalTransport } from "@/connection";
import { parseModelCatalogReply, parseSessionListReply } from "@/session";

export interface LocalMachineSession {
	descriptor: ConnectionDescriptor;
	sessionId: string;
	title?: string;
	/** First prompt, when session.list exposes metadata.prompt. */
	prompt?: string;
	status?: string;
	createdAt?: number;
	updatedAt?: number;
	workspaceRoot?: string;
	cwd?: string;
	providerId?: string;
	modelId?: string;
}

interface SessionListClient {
	connect(): Promise<void>;
	command(
		command: "session.list",
		payload: Record<string, unknown>,
		sessionId?: string,
		options?: { timeoutMs?: number | null },
	): Promise<{ payload?: unknown }>;
	close(): void;
}

interface CatalogClient {
	connect(): Promise<void>;
	command(
		command: "catalog.list",
		payload: Record<string, unknown>,
	): Promise<{ payload?: unknown }>;
	close(): void;
}

export interface ListLocalMachineSessionsDeps {
	getAccessToken?: () => Promise<string | null>;
	createClient?: (
		descriptor: ConnectionDescriptor,
	) => Promise<SessionListClient>;
}

export interface LocalModelOption extends CloudModelOption {
	providerId: string;
}

/** Reads the same provider/model catalog Cline uses for a new session. */
export async function listLocalMachineModels(
	descriptor: ConnectionDescriptor,
	deps: {
		getAccessToken?: () => Promise<string | null>;
		createClient?: (descriptor: ConnectionDescriptor) => Promise<CatalogClient>;
	} = {},
): Promise<readonly LocalModelOption[]> {
	const machine = { ...descriptor };
	delete machine.hubSessionId;
	delete machine.sessionTitle;
	const client = deps.createClient
		? await deps.createClient(machine)
		: ((await createProductionClient(
				machine,
				deps.getAccessToken,
			)) as unknown as CatalogClient);
	try {
		await client.connect();
		const reply = await client.command("catalog.list", {});
		const parsed = parseModelCatalogReply(reply.payload);
		if (parsed.status !== "ok") {
			throw new Error(
				`This computer's Cline is too old to list models (${parsed.detail}).`,
			);
		}
		return localModelOptions(parsed.catalog);
	} finally {
		client.close();
	}
}

/** One reconnectable descriptor per physical hub, with any old session pin removed. */
export function localMachineDescriptors(
	endpoints: readonly ConnectionDescriptor[],
): readonly ConnectionDescriptor[] {
	const seen = new Set<string>();
	const machines: ConnectionDescriptor[] = [];
	for (const endpoint of endpoints) {
		if (endpoint.mode !== "local") continue;
		const key = endpoint.relayMachineId ?? endpoint.url;
		if (seen.has(key)) continue;
		seen.add(key);
		const machine = { ...endpoint };
		delete machine.hubSessionId;
		delete machine.sessionTitle;
		machines.push(machine);
	}
	return machines;
}

async function createProductionClient(
	descriptor: ConnectionDescriptor,
	getAccessToken?: () => Promise<string | null>,
): Promise<SessionListClient> {
	const transport = await resolveLocalTransport(descriptor, {
		...(getAccessToken ? { getAccessToken } : {}),
	});
	return new HubClient({
		url: descriptor.url,
		authMode: transport.authMode,
		credential: transport.authToken ?? "",
		clientType: "cline-mobile",
		displayName: "Cline session browser",
		...(transport.WebSocketImpl
			? { WebSocketImpl: transport.WebSocketImpl }
			: {}),
	});
}

/**
 * Read a machine's real ClineCore session index. This is discovery only: it
 * never attaches, creates, mutates, or keeps a background socket alive.
 */
export async function listLocalMachineSessions(
	descriptor: ConnectionDescriptor,
	deps: ListLocalMachineSessionsDeps = {},
): Promise<readonly LocalMachineSession[]> {
	const machine = { ...descriptor };
	delete machine.hubSessionId;
	delete machine.sessionTitle;
	const client = deps.createClient
		? await deps.createClient(machine)
		: await createProductionClient(machine, deps.getAccessToken);
	try {
		await client.connect();
		const reply = await client.command(
			"session.list",
			{ limit: 100 },
			undefined,
			{ timeoutMs: 8_000 },
		);
		const parsed = parseSessionListReply(reply.payload);
		if (parsed.status === "invalid") {
			throw new Error(
				`Cline returned an unreadable session list: ${parsed.detail}`,
			);
		}
		if (parsed.invalidCount > 0 && parsed.sessions.length === 0) {
			throw new Error(
				`Cline returned ${parsed.invalidCount} unreadable session row(s).`,
			);
		}
		return parsed.sessions.map((session) => ({
			descriptor: machine,
			sessionId: session.sessionId,
			...(session.metadata?.title?.trim()
				? { title: session.metadata.title.trim() }
				: session.metadata?.prompt?.trim()
					? { title: session.metadata.prompt.trim().split(/\r?\n/, 1)[0] }
					: {}),
			...(session.metadata?.prompt?.trim()
				? { prompt: session.metadata.prompt.trim() }
				: {}),
			...(session.status ? { status: session.status } : {}),
			...(session.createdAt !== undefined
				? { createdAt: session.createdAt }
				: {}),
			...(session.updatedAt !== undefined
				? { updatedAt: session.updatedAt }
				: {}),
			...(session.workspaceRoot
				? { workspaceRoot: session.workspaceRoot }
				: {}),
			...(session.cwd ? { cwd: session.cwd } : {}),
			...(session.metadata?.provider
				? { providerId: session.metadata.provider }
				: {}),
			...(session.metadata?.model ? { modelId: session.metadata.model } : {}),
		}));
	} finally {
		client.close();
	}
}

export interface LocalSessionsState {
	sessions: readonly LocalMachineSession[];
	loading: boolean;
	/** Machine ids whose last discovery failed. Machine launch still remains usable. */
	unavailableMachineIds: readonly string[];
}

/** Discover local sessions on mount and whenever the saved machine set changes. */
export function useLocalSessions(
	endpoints: readonly ConnectionDescriptor[],
): LocalSessionsState & { refresh(): void } {
	const [generation, setGeneration] = useState(0);
	const [state, setState] = useState<LocalSessionsState>({
		sessions: [],
		loading: false,
		unavailableMachineIds: [],
	});
	const refresh = useCallback(() => setGeneration((value) => value + 1), []);

	useEffect(() => {
		// Reading the generation is intentional: incrementing it is the imperative
		// refresh signal when the saved endpoint array itself has not changed.
		void generation;
		const machines = localMachineDescriptors(endpoints);
		if (machines.length === 0) {
			setState({ sessions: [], loading: false, unavailableMachineIds: [] });
			return;
		}
		let current = true;
		setState((previous) => ({ ...previous, loading: true }));
		void Promise.allSettled(
			machines.map((machine) =>
				listLocalMachineSessions(machine, {
					getAccessToken: () => cloudAuthStore.getValidAccessToken(),
				}),
			),
		).then((results) => {
			if (!current) return;
			setState((previous) => {
				const sessions: LocalMachineSession[] = [];
				const unavailableMachineIds: string[] = [];
				results.forEach((result, index) => {
					const machine = machines[index];
					if (!machine) return;
					const machineId = machine.relayMachineId ?? machine.url;
					if (result.status === "fulfilled") {
						sessions.push(...result.value);
						return;
					}
					unavailableMachineIds.push(machineId);
					// A refresh failure means "stale", not "deleted". Keep only this
					// machine's last successful rows while other machines update normally.
					sessions.push(
						...previous.sessions.filter(
							(session) =>
								(session.descriptor.relayMachineId ??
									session.descriptor.url) === machineId,
						),
					);
				});
				return { sessions, loading: false, unavailableMachineIds };
			});
		});
		return () => {
			current = false;
		};
	}, [endpoints, generation]);

	return { ...state, refresh };
}
