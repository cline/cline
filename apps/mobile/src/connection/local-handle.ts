/**
 * Connects directly to a local hub without provisioning a cloud sandbox.
 * Reuses resolveCloudSession with a synthetic remote session and a one-entry
 * gateway to list, select, or lazily create the inner hub session.
 * Local authentication uses hub-subprotocol with the hub token.
 */

import { HubClient, type WebSocketCtor } from "@cline/hub-client";
import { buildClineSystemPrompt, CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import {
	asRemoteSessionId,
	FakeRemoteSessionGateway,
	type RemoteSession,
	resolveCloudSession,
	type SessionDiagnostic,
	type SessionHandle,
} from "../session";
import { ASK_QUESTION_CAPABILITY } from "../session/schemas";

/** Synthetic remote-session id for the (single) local hub. */
const LOCAL_REMOTE_SESSION_ID = asRemoteSessionId("local-hub");

export interface CreateLocalSessionHandleOptions {
	/** `ws(s)://host:port/path` of the local hub. `http(s)` is rewritten to `ws(s)`. */
	url: string;
	/** Hub auth token printed by the hub (`cline-hub-auth.<token>` credential). */
	authToken?: string;
	/** Relay hosts authenticate locally, so HubClient sends no hub credential. */
	authMode?: "hub-subprotocol" | "none";
	/** Workspace the inner session runs against; the hub may override it. */
	workspaceRoot?: string;
	/** Working directory for the inner session. Defaults to `workspaceRoot`. */
	cwd?: string;
	/** Provider id for the lazy `session.create`. */
	providerId?: string;
	/** Model id for the lazy `session.create`. */
	modelId?: string;
	clientType?: string;
	displayName?: string;
	/** Override the whole `session.create` payload (advanced/tests). */
	createSessionInput?: Record<string, unknown>;
	/** Ignore existing inner sessions and lazily create a fresh one. */
	createNewSession?: boolean;
	/** Exact hub session named by a handoff link. */
	hubSessionId?: string;
	/** Injectable socket, so a test can drive drops/reconnects. */
	WebSocketImpl?: WebSocketCtor;
	onDiagnostic?: (diagnostic: SessionDiagnostic) => void;
}

/** The `session.create` payload a local hub expects when none is supplied. */
export function buildLocalCreateSessionInput(
	options: CreateLocalSessionHandleOptions,
): Record<string, unknown> {
	const workspaceRoot = options.workspaceRoot;
	const cwd = options.cwd ?? workspaceRoot;
	const providerId = options.providerId ?? "cline";
	const modelId = options.modelId ?? CLINE_DEFAULT_MODEL_ID;
	const systemPrompt = buildClineSystemPrompt({
		ide: "Cline",
		mode: "act",
		platform: "mobile",
		providerId,
		workspaceRoot: workspaceRoot ?? cwd ?? "",
	});
	return {
		...(workspaceRoot ? { workspaceRoot } : {}),
		...(cwd ? { cwd } : {}),
		sessionConfig: {
			providerId,
			modelId,
			...(cwd ? { cwd } : {}),
			...(workspaceRoot ? { workspaceRoot } : {}),
			systemPrompt,
			mode: "act",
			enableTools: true,
			checkpoint: { enabled: true },
			compaction: { enabled: true },
		},
		metadata: { source: "core", interactive: true },
		runtimeOptions: {
			clientContributions: [
				{
					kind: "toolExecutor",
					executor: "askQuestion",
					capabilityName: ASK_QUESTION_CAPABILITY,
				},
			],
		},
	};
}

function localRemoteSession(url: string): RemoteSession {
	return {
		id: LOCAL_REMOTE_SESSION_ID,
		// For a local hub the "sandbox url" *is* the hub url.
		sandboxUrl: url,
		status: "running",
		expiredAt: null,
		title: "Local hub",
	};
}

/**
 * Connects to a local hub and resolves a {@link SessionHandle} ready for
 * {@link SessionConnection}. Fresh hubs come back with `needsCreate === true`; the
 * inner session is created on the first `sendInput`.
 */
export async function createLocalSessionHandle(
	options: CreateLocalSessionHandleOptions,
): Promise<SessionHandle> {
	return await resolveCloudSession({
		gateway: new FakeRemoteSessionGateway([localRemoteSession(options.url)]),
		remoteSessionId: LOCAL_REMOTE_SESSION_ID,
		createSessionInput:
			options.createSessionInput ?? buildLocalCreateSessionInput(options),
		...(options.createNewSession ? { createNewSession: true } : {}),
		...(options.hubSessionId ? { hubSessionId: options.hubSessionId } : {}),
		...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
		clientFactory: ({ url, onConnectionState }) =>
			new HubClient({
				url,
				authMode: options.authMode ?? "hub-subprotocol",
				credential: options.authToken ?? "",
				clientType: options.clientType ?? "cline-mobile",
				displayName: options.displayName ?? "Cline",
				onConnectionState,
				...(options.WebSocketImpl
					? { WebSocketImpl: options.WebSocketImpl }
					: {}),
			}),
	});
}
