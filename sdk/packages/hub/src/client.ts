import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	HubTransportFrame,
} from "@clinebot/shared";
import {
	type HubEndpointOverrides,
	resolveHubEndpointOptions,
} from "./defaults";
import {
	createHubServerUrl,
	readHubDiscovery,
	resolveHubOwnerContext,
} from "./discovery";

export interface HubConnection {
	send(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
	close(): void;
}

export interface HubCommandRequest
	extends Omit<HubCommandEnvelope, "version" | "clientId"> {
	version?: HubCommandEnvelope["version"];
	clientId?: string;
}

function normalizeHubConnectionError(error: unknown, url: string): Error {
	if (error instanceof Error) {
		return error;
	}
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string" &&
		(error as { message: string }).message.trim()
	) {
		return new Error((error as { message: string }).message.trim());
	}
	const eventType =
		error &&
		typeof error === "object" &&
		"type" in error &&
		typeof (error as { type?: unknown }).type === "string"
			? (error as { type: string }).type.trim()
			: "";
	return new Error(
		eventType
			? `Failed to connect to hub at ${url} (${eventType} event before socket open).`
			: `Failed to connect to hub at ${url}.`,
	);
}

function hasExplicitEndpoint(overrides: HubEndpointOverrides): boolean {
	return (
		overrides.host !== undefined ||
		overrides.port !== undefined ||
		overrides.pathname !== undefined
	);
}

export async function resolveHubUrl(
	overrides: HubEndpointOverrides = {},
): Promise<string> {
	const endpoint = resolveHubEndpointOptions(overrides);
	if (!hasExplicitEndpoint(overrides)) {
		const owner = resolveHubOwnerContext();
		const discovery = await readHubDiscovery(owner.discoveryPath);
		if (discovery?.url) {
			return discovery.url;
		}
	}
	return createHubServerUrl(endpoint.host, endpoint.port, endpoint.pathname);
}

export async function connectToHub(url: string): Promise<HubConnection> {
	return await new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const pending = new Map<
			string,
			{
				resolve: (reply: HubReplyEnvelope) => void;
				reject: (error: unknown) => void;
			}
		>();
		let counter = 0;

		ws.addEventListener("open", () => {
			resolve({
				send(envelope) {
					const requestId = envelope.requestId ?? `hub-client-${++counter}`;
					return new Promise<HubReplyEnvelope>((res, rej) => {
						pending.set(requestId, { resolve: res, reject: rej });
						const frame: HubTransportFrame = {
							kind: "command",
							envelope: { ...envelope, requestId },
						};
						ws.send(JSON.stringify(frame));
					});
				},
				close() {
					ws.close();
				},
			});
		});

		ws.addEventListener("message", (event) => {
			const frame = JSON.parse(String(event.data)) as HubTransportFrame;
			if (frame.kind === "reply" && frame.envelope.requestId) {
				const entry = pending.get(frame.envelope.requestId);
				if (entry) {
					pending.delete(frame.envelope.requestId);
					entry.resolve(frame.envelope);
				}
			}
		});

		ws.addEventListener("close", () => {
			for (const entry of pending.values()) {
				entry.reject(new Error("Hub connection closed"));
			}
			pending.clear();
		});

		ws.addEventListener("error", (error) => {
			reject(normalizeHubConnectionError(error, url));
		});
	});
}

export async function probeHubConnection(url: string): Promise<boolean> {
	try {
		const connection = await connectToHub(url);
		connection.close();
		return true;
	} catch {
		return false;
	}
}

export async function sendHubCommand(
	overrides: HubEndpointOverrides,
	envelope: HubCommandRequest,
): Promise<HubReplyEnvelope> {
	const url = await resolveHubUrl(overrides);
	const connection = await connectToHub(url);
	try {
		return await connection.send({
			version: envelope.version ?? "v1",
			clientId: envelope.clientId ?? "hub-client",
			...envelope,
		});
	} finally {
		connection.close();
	}
}
