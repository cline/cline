/**
 * Session-to-session messaging.
 *
 * The team mailbox in `extensions/tools/team` addresses agents inside one
 * `AgentTeamsRuntime`. This addresses whole sessions, so two independently
 * started top-level agents can hand work to each other.
 *
 * Every message is written to a durable store first and only then handed to
 * the target's pending-prompt queue, so a message to a session that is not
 * running survives until that session comes back.
 */

import {
	DEFAULT_SESSION_MESSENGER_LIMITS,
	formatSessionMessageAsUserTurn,
	type ReadSessionInboxInput,
	type SendSessionMessageInput,
	type SendSessionMessageResult,
	type SessionMessage,
	type SessionMessageDelivery,
	type SessionMessengerLimits,
	type SessionPeer,
} from "@cline/shared";
import { nanoid } from "nanoid";
import type { SessionStatus } from "../../types/common";
import { isTerminalSessionStatus } from "../../types/common";
import type { SessionMailStore } from "../../types/storage";
import type { SessionRow } from "../models/session-row";

export interface SessionDirectory {
	getSession(sessionId: string): Promise<SessionRow | undefined>;
	listSessions(options: {
		limit: number;
		status?: string;
	}): Promise<SessionRow[]>;
}

export interface SessionMailDeliveryTarget {
	/**
	 * Hands `prompt` to the target session's pending-prompt queue.
	 *
	 * Returns true when the target was live and accepted it. Returning false
	 * (rather than throwing) means "not reachable right now" and leaves the
	 * message pending for a later drain.
	 */
	deliver(input: {
		sessionId: string;
		prompt: string;
		delivery: SessionMessageDelivery;
	}): Promise<boolean>;
}

export interface SessionMessengerOptions {
	store: SessionMailStore;
	directory: SessionDirectory;
	target: SessionMailDeliveryTarget;
	limits?: Partial<SessionMessengerLimits>;
	/** Overridable for tests. */
	now?: () => Date;
}

/** Thrown when a send is refused. Tools surface this as structured data. */
export class SessionMessageRejectedError extends Error {
	constructor(
		message: string,
		readonly reason:
			| "self_send"
			| "unknown_peer"
			| "hop_limit"
			| "cycle"
			| "rate_limit",
	) {
		super(message);
		this.name = "SessionMessageRejectedError";
	}
}

interface CausalContext {
	hopCount: number;
	hopChain: string[];
}

export class SessionMessenger {
	private readonly store: SessionMailStore;
	private readonly directory: SessionDirectory;
	private readonly target: SessionMailDeliveryTarget;
	private readonly limits: SessionMessengerLimits;
	private readonly now: () => Date;

	/**
	 * Causal context of the message that most recently woke each session.
	 *
	 * In-memory on purpose: it describes the live wake cycle in this process.
	 * Cross-process, the chain travels inside the message itself and is
	 * recorded here by whichever process performs the delivery.
	 */
	private readonly lastInbound = new Map<string, CausalContext>();

	constructor(options: SessionMessengerOptions) {
		this.store = options.store;
		this.directory = options.directory;
		this.target = options.target;
		this.limits = { ...DEFAULT_SESSION_MESSENGER_LIMITS, ...options.limits };
		this.now = options.now ?? (() => new Date());
	}

	async listPeers(options?: {
		reachableOnly?: boolean;
		workspaceRoot?: string;
		limit?: number;
		excludeSessionId?: string;
	}): Promise<SessionPeer[]> {
		const rows = await this.directory.listSessions({
			limit: Math.min(Math.max(options?.limit ?? 25, 1), 100),
		});
		return rows
			.filter((row) => row.sessionId !== options?.excludeSessionId)
			.map((row) => toPeer(row))
			.filter((peer) => {
				if (options?.reachableOnly && !peer.reachable) {
					return false;
				}
				if (
					options?.workspaceRoot &&
					peer.workspaceRoot !== options.workspaceRoot
				) {
					return false;
				}
				return true;
			});
	}

	async send(
		input: SendSessionMessageInput,
	): Promise<SendSessionMessageResult> {
		const { fromSessionId, toSessionId } = input;
		if (fromSessionId === toSessionId) {
			throw new SessionMessageRejectedError(
				"A session cannot send a message to itself.",
				"self_send",
			);
		}

		const recipient = await this.directory.getSession(toSessionId);
		if (!recipient) {
			throw new SessionMessageRejectedError(
				`No session found with id "${toSessionId}".`,
				"unknown_peer",
			);
		}

		this.assertWithinRateLimit(fromSessionId);

		const causal = this.resolveCausalContext(fromSessionId, input.inResponseTo);
		const hopCount = causal.hopCount + 1;
		if (hopCount > this.limits.maxHops) {
			throw new SessionMessageRejectedError(
				`Hop limit of ${this.limits.maxHops} reached for this message chain. ` +
					"A human needs to re-initiate rather than sessions continuing to wake each other.",
				"hop_limit",
			);
		}
		if (causal.hopChain.includes(toSessionId)) {
			throw new SessionMessageRejectedError(
				`Session "${toSessionId}" is already part of this message chain, ` +
					"so delivering would create a wake loop.",
				"cycle",
			);
		}

		const sender = await this.directory.getSession(fromSessionId);
		const message: SessionMessage = {
			id: `smsg_${nanoid(12)}`,
			fromSessionId,
			fromLabel: buildSessionLabel(sender),
			toSessionId,
			subject: input.subject,
			body: input.body,
			delivery: input.delivery ?? "queue",
			status: "pending",
			hopCount,
			hopChain: [...causal.hopChain, fromSessionId],
			sentAt: this.now(),
		};

		// Persist before delivering: a crash between the two leaves a message
		// that can still be drained, whereas the reverse loses it entirely.
		this.store.append(message);

		const deliveredNow = await this.tryDeliver(message);
		return {
			message: deliveredNow
				? { ...message, status: "delivered", deliveredAt: this.now() }
				: message,
			deliveredNow,
		};
	}

	readInbox(input: ReadSessionInboxInput): SessionMessage[] {
		const messages = this.store.listInbox(input.sessionId, {
			unreadOnly: input.unreadOnly ?? true,
			limit: input.limit,
		});
		if (input.markRead ?? true) {
			this.store.markRead(messages.map((message) => message.id));
		}
		return messages;
	}

	/**
	 * Delivers every message still pending for a session.
	 *
	 * Call when a session becomes live so mail that arrived while it was down
	 * reaches it. Returns the number delivered.
	 */
	async deliverPending(sessionId: string): Promise<number> {
		const pending = this.store.listInbox(sessionId, { status: "pending" });
		let delivered = 0;
		for (const message of pending) {
			if (await this.tryDeliver(message)) {
				delivered++;
			}
		}
		return delivered;
	}

	private async tryDeliver(message: SessionMessage): Promise<boolean> {
		let accepted = false;
		try {
			accepted = await this.target.deliver({
				sessionId: message.toSessionId,
				prompt: formatSessionMessageAsUserTurn(message),
				delivery: message.delivery,
			});
		} catch {
			// Treat a transport failure as "not reachable" and leave the
			// message pending rather than losing it.
			return false;
		}
		if (!accepted) {
			return false;
		}
		this.store.markDelivered(message.id);
		this.lastInbound.set(message.toSessionId, {
			hopCount: message.hopCount,
			hopChain: message.hopChain,
		});
		return true;
	}

	private resolveCausalContext(
		fromSessionId: string,
		explicit?: CausalContext,
	): CausalContext {
		if (explicit) {
			return explicit;
		}
		return this.lastInbound.get(fromSessionId) ?? { hopCount: 0, hopChain: [] };
	}

	private assertWithinRateLimit(fromSessionId: string): void {
		const since = new Date(this.now().getTime() - this.limits.rateWindowMs);
		const sent = this.store.countSentSince(fromSessionId, since);
		if (sent >= this.limits.maxSendsPerWindow) {
			throw new SessionMessageRejectedError(
				`Session "${fromSessionId}" has sent ${sent} messages in the last ` +
					`${Math.round(this.limits.rateWindowMs / 1000)}s, which is at the limit.`,
				"rate_limit",
			);
		}
	}
}

function buildSessionLabel(row: SessionRow | undefined): string | undefined {
	if (!row) {
		return undefined;
	}
	const prompt = row.prompt?.trim();
	if (prompt) {
		const firstLine = prompt.split("\n")[0]?.trim() ?? "";
		if (firstLine) {
			return firstLine.length > 80
				? `${firstLine.slice(0, 77).trimEnd()}...`
				: firstLine;
		}
	}
	return row.cwd || undefined;
}

function toPeer(row: SessionRow): SessionPeer {
	return {
		sessionId: row.sessionId,
		status: row.status,
		cwd: row.cwd,
		workspaceRoot: row.workspaceRoot,
		provider: row.provider,
		model: row.model,
		prompt: row.prompt?.trim() || undefined,
		startedAt: row.startedAt,
		updatedAt: row.updatedAt,
		isSubagent: row.isSubagent,
		reachable: !isTerminalSessionStatus(row.status as SessionStatus),
	};
}
