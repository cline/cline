import {
	type HubCommandName,
	type HubEventEnvelope,
	type PluginUiInvokeInput,
	type PluginUiInvokeOutcome,
	type PluginUiInvokeResult,
	type PluginUiStateEnvelope,
	readPluginUiEnvelope,
} from "@cline/shared";
import type { PluginUiApi } from "../../services/plugin-ui-api";
import type { NodeHubClient } from "./index";

export interface HubPluginUiStreamHandlers {
	onState?: (state: PluginUiStateEnvelope) => void;
	onError?: (error: Error) => void;
}

export interface HubPluginUiApi extends PluginUiApi {
	/**
	 * Call after every registration with the hub. It retries a hub that
	 * answered `unsupported_command` (it may have been upgraded), and re-sends
	 * the remembered attaches, whose leases the hub ended with the old connection.
	 */
	onRegistered(): void;
	/** Stops re-sending this session's attach, for a session the client no longer follows. */
	forget(sessionId: string): void;
	/** Stops re-sending every attach, for a client that is shutting down. */
	forgetAll(): void;
}

type PluginUiRequest = Pick<PluginUiInvokeInput, "slot" | "action">;

const INVOKE_OUTCOMES: ReadonlySet<string> = new Set<PluginUiInvokeOutcome>([
	"ok",
	"refused",
	"rejected",
	"unavailable",
	"timeout",
]);

function isUnsupportedCommand(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "unsupported_command"
	);
}

function readInvokeResult(
	payload: Record<string, unknown>,
): PluginUiInvokeResult {
	const { outcome, reason, epoch } = payload;
	if (typeof outcome !== "string" || !INVOKE_OUTCOMES.has(outcome)) {
		return { outcome: "unavailable" };
	}
	const state = readPluginUiEnvelope(payload.state);
	return {
		outcome: outcome as PluginUiInvokeOutcome,
		...(reason === "stale" || reason === "unsendable" ? { reason } : {}),
		...(state ? { state } : {}),
		...(typeof epoch === "number" && Number.isFinite(epoch) ? { epoch } : {}),
	};
}

/**
 * `plugins.ui.*` over a hub connection. Never throws: transport errors and
 * an older hub without the commands come back as `[]` or `unavailable`, and
 * after an `unsupported_command` reply it sends nothing until the next
 * registration.
 */
export function createHubPluginUiApi(
	client: Pick<NodeHubClient, "command">,
	options?: { beforeCommand?(sessionId: string): void },
): HubPluginUiApi {
	let unsupported = false;
	/** The last attach per session, whatever its reply, re-sent after every registration. */
	const attached = new Map<string, PluginUiRequest>();
	/**
	 * Attaches still awaiting their reply. A registration skips them: the
	 * command itself, or its transport-recovery retry, sends them on the new
	 * connection, so re-sending would attach twice.
	 */
	const attachesInFlight = new Map<string, PluginUiRequest>();

	async function send(
		command: HubCommandName,
		sessionId: string,
		payload: Record<string, unknown>,
	): Promise<Record<string, unknown> | undefined> {
		if (unsupported) return undefined;
		try {
			options?.beforeCommand?.(sessionId);
			const reply = await client.command(command, payload, sessionId);
			if (reply.ok === false) {
				unsupported ||= reply.error?.code === "unsupported_command";
				return undefined;
			}
			return reply.payload ?? {};
		} catch (error) {
			unsupported ||= isUnsupportedCommand(error);
			return undefined;
		}
	}

	function forget(sessionId: string): void {
		attached.delete(sessionId);
		attachesInFlight.delete(sessionId);
	}

	return {
		async get(input): Promise<PluginUiStateEnvelope[]> {
			const sessionId = input?.sessionId;
			if (typeof sessionId !== "string" || !sessionId) return [];
			const states = (await send("plugins.ui.get", sessionId, {}))?.states;
			if (!Array.isArray(states)) return [];
			return states.flatMap((state) => {
				const envelope = readPluginUiEnvelope(state);
				return envelope ? [envelope] : [];
			});
		},

		async invoke(input): Promise<PluginUiInvokeResult> {
			const sessionId = input?.sessionId;
			if (typeof sessionId !== "string" || !sessionId) {
				return { outcome: "unavailable" };
			}
			const request: PluginUiRequest = {
				slot: input.slot,
				action: input.action,
			};
			const verb = (input.action as { verb?: unknown } | undefined)?.verb;
			if (verb === "attach") {
				attached.set(sessionId, request);
				attachesInFlight.set(sessionId, request);
			}
			if (verb === "detach") forget(sessionId);
			const payload = await send("plugins.ui.invoke", sessionId, {
				...request,
			});
			if (attachesInFlight.get(sessionId) === request) {
				attachesInFlight.delete(sessionId);
			}
			return payload ? readInvokeResult(payload) : { outcome: "unavailable" };
		},

		onRegistered(): void {
			unsupported = false;
			for (const [sessionId, request] of attached) {
				if (attachesInFlight.has(sessionId)) continue;
				void send("plugins.ui.invoke", sessionId, { ...request });
			}
		},

		forget,

		forgetAll(): void {
			attached.clear();
			attachesInFlight.clear();
		},
	};
}

export function streamHubPluginUi(
	client: Pick<NodeHubClient, "subscribe" | "onRegistered" | "connect">,
	pluginUi: Pick<PluginUiApi, "get">,
	input: { sessionId: string },
	handlers: HubPluginUiStreamHandlers,
): () => void {
	let streaming = true;
	const deliver = (state: PluginUiStateEnvelope | undefined) => {
		if (streaming && state?.sessionId === input.sessionId) {
			handlers.onState?.(state);
		}
	};
	const deliverCurrent = () => {
		void pluginUi.get({ sessionId: input.sessionId }).then((states) => {
			for (const state of states) {
				deliver(state);
			}
		});
	};
	// Global, as streamEvents is: a second, session-scoped subscription on
	// this client would make the hub send that session's events twice.
	const unsubscribe = client.subscribe((event: HubEventEnvelope) => {
		if (event.event === "plugins.ui.state") {
			deliver(readPluginUiEnvelope(event.payload));
		}
	});
	let fetchedOnRegistration = false;
	const stopRefetching = client.onRegistered(() => {
		fetchedOnRegistration = true;
		deliverCurrent();
	});
	void client.connect().then(
		() => {
			if (!fetchedOnRegistration) {
				deliverCurrent();
			}
		},
		(error) => {
			handlers.onError?.(
				error instanceof Error ? error : new Error(String(error)),
			);
		},
	);
	return () => {
		streaming = false;
		unsubscribe();
		stopRefetching();
	};
}
