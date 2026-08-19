/**
 * Connector-to-session semantics (Gateway RFC, Phase 6).
 *
 * `@cline/bot` owns what a connector message *means* for a bot; the
 * Gateway owns transport, persistence, auth boundaries, and worker
 * supervision, all injected here as ports. Semantics encoded:
 *
 * - Every connector targets exactly one bot. A message claiming another
 *   connector's identity is rejected before anything is looked up.
 * - The mapping `(connectorId, externalAccountId, externalConversationId)
 *   -> (botId, sessionId, principal context)` is durable: the first
 *   accepted message admits a run (which lazily creates the bot's
 *   canonical session) and records the route; later messages reuse it.
 *   Connector, desktop, and CLI messages therefore share one canonical
 *   session — the bot's — rather than a connector-private one.
 * - Bots see normalized source metadata and an authorized reply
 *   capability, never adapter credentials.
 */

import type {
	BotId,
	ConnectorId,
	PrincipalId,
	RunAccepted,
	SessionId,
} from "@cline/shared/gateway";
import type { BotClock } from "./ports";

export interface ConnectorDescriptor {
	readonly connectorId: ConnectorId;
	/** The single bot this connector targets. */
	readonly botId: BotId;
	/** Adapter kind, e.g. `telegram`, `slack`. */
	readonly kind: string;
	readonly name: string;
}

/**
 * A normalized inbound message. This is everything a bot may see about
 * the source: identity strings and display metadata — no tokens, no
 * adapter session objects, no transport handles.
 */
export interface NormalizedConnectorMessage {
	readonly connectorId: ConnectorId;
	readonly externalAccountId: string;
	readonly externalConversationId: string;
	/** Adapter-deduplicated message identity (dedupe cursor input). */
	readonly externalMessageId: string;
	readonly text: string;
	readonly senderDisplay?: string;
	readonly sentAt?: number;
	/** Additional normalized source metadata (platform, chat title, ...). */
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConnectorRoute {
	readonly connectorId: ConnectorId;
	readonly externalAccountId: string;
	readonly externalConversationId: string;
	readonly botId: BotId;
	readonly sessionId: SessionId;
	readonly principalId?: PrincipalId;
	readonly createdAt: number;
}

/** Durable route mapping; the Gateway implements it on the authority DB. */
export interface ConnectorRouteRepository {
	get(
		connectorId: ConnectorId,
		externalAccountId: string,
		externalConversationId: string,
	): ConnectorRoute | undefined;
	save(route: ConnectorRoute): void;
}

/**
 * Run admission port. The Gateway implements it over its runtime so a
 * connector message enters the same durable FIFO queue — and the same
 * canonical session — as desktop/CLI prompts for the bot.
 */
export interface ConnectorRunAdmission {
	submit(
		botId: BotId,
		prompt: string,
		context: {
			connectorId: ConnectorId;
			externalAccountId: string;
			externalConversationId: string;
		},
	): RunAccepted & { sessionId: SessionId };
}

/**
 * Authorized reply capability. Implemented by the Gateway with the
 * adapter's credentials; the bot side only ever holds this narrow port.
 */
export interface ConnectorReplyPort {
	reply(
		conversation: {
			externalAccountId: string;
			externalConversationId: string;
		},
		text: string,
	): Promise<void>;
}

export class ConnectorScopeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConnectorScopeError";
	}
}

export interface ConnectorInboxPorts {
	routes: ConnectorRouteRepository;
	admission: ConnectorRunAdmission;
	clock: BotClock;
}

export interface ConnectorInboundResult {
	readonly route: ConnectorRoute;
	readonly accepted: RunAccepted & { sessionId: SessionId };
	/** True when this message created the route (first contact). */
	readonly routeCreated: boolean;
}

/** Render the prompt a bot receives for an inbound connector message. */
export function formatConnectorPrompt(
	descriptor: ConnectorDescriptor,
	message: NormalizedConnectorMessage,
): string {
	const source = `${descriptor.kind}:${message.externalConversationId}`;
	const sender = message.senderDisplay ? ` from ${message.senderDisplay}` : "";
	return `[${source}${sender}] ${message.text}`;
}

/**
 * One connector's inbound semantics for its single bot.
 */
export class ConnectorInbox {
	private readonly descriptor: ConnectorDescriptor;
	private readonly ports: ConnectorInboxPorts;

	constructor(descriptor: ConnectorDescriptor, ports: ConnectorInboxPorts) {
		this.descriptor = descriptor;
		this.ports = ports;
	}

	/**
	 * Handle one normalized inbound message: resolve (or create) the
	 * canonical route and admit the prompt into the bot's session queue.
	 */
	handleMessage(
		message: NormalizedConnectorMessage,
		options: { principalId?: PrincipalId } = {},
	): ConnectorInboundResult {
		if (message.connectorId !== this.descriptor.connectorId) {
			throw new ConnectorScopeError(
				`Message for connector ${message.connectorId} rejected by connector ${this.descriptor.connectorId}: ` +
					"an adapter instance handles exactly its own connector",
			);
		}
		const prompt = formatConnectorPrompt(this.descriptor, message);
		const existing = this.ports.routes.get(
			this.descriptor.connectorId,
			message.externalAccountId,
			message.externalConversationId,
		);
		if (existing && existing.botId !== this.descriptor.botId) {
			throw new ConnectorScopeError(
				`Route for connector ${this.descriptor.connectorId} points at bot ${existing.botId}, ` +
					`but this connector targets bot ${this.descriptor.botId}`,
			);
		}
		const accepted = this.ports.admission.submit(
			this.descriptor.botId,
			prompt,
			{
				connectorId: this.descriptor.connectorId,
				externalAccountId: message.externalAccountId,
				externalConversationId: message.externalConversationId,
			},
		);
		// The bot's session is canonical: if the session moved (e.g. the
		// old one was closed and admission created a fresh one), the route
		// follows it.
		if (!existing || existing.sessionId !== accepted.sessionId) {
			const route: ConnectorRoute = {
				connectorId: this.descriptor.connectorId,
				externalAccountId: message.externalAccountId,
				externalConversationId: message.externalConversationId,
				botId: this.descriptor.botId,
				sessionId: accepted.sessionId,
				...((options.principalId ?? existing?.principalId)
					? { principalId: options.principalId ?? existing?.principalId }
					: {}),
				createdAt: existing?.createdAt ?? this.ports.clock.now(),
			};
			this.ports.routes.save(route);
			return { route, accepted, routeCreated: !existing };
		}
		return { route: existing, accepted, routeCreated: false };
	}
}
