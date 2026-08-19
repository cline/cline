/**
 * `send_connector_message` — the constrained proactive messaging tool
 * (Gateway RFC, Phase 6).
 *
 * The tool is bound per invocation (bot + run) and delegates every
 * decision to the ConnectorMessenger policy gate: destination defaults
 * to the originating conversation, explicit destinations must belong to
 * the current bot, unrelated destinations require approval, rate limits
 * apply, and the message is persisted with an idempotency key before any
 * delivery attempt. The tool returns delivery status only — never
 * credentials, tokens, or transport details.
 */

import type { EngineInvocation } from "@cline/bot";
import type { AgentTool } from "@cline/engine";
import type {
	BotId,
	ConnectorId,
	OutboundMessageId,
	RunId,
} from "@cline/shared/gateway";
import type { OutboundDeliveryWorker } from "./delivery";
import type { ConnectorMessenger } from "./messenger";

export const SEND_CONNECTOR_MESSAGE_TOOL = "send_connector_message";

export interface SendConnectorMessageInput {
	/** Message text; split per platform limits at delivery time. */
	text: string;
	/** Explicit destination; defaults to the originating conversation. */
	connectorId?: string;
	externalConversationId?: string;
	externalAccountId?: string;
	/** Client-supplied dedupe key; defaults to run + tool call identity. */
	idempotencyKey?: string;
}

export interface SendConnectorMessageOutput {
	outboundId: OutboundMessageId;
	state: "pending" | "sending" | "delivered" | "failed";
	attempts: number;
	externalMessageIds?: readonly string[];
	lastError?: string;
	/** False when the idempotency key matched an existing message. */
	created: boolean;
}

export interface SendConnectorMessageToolDeps {
	messenger: ConnectorMessenger;
	/** When present, one immediate delivery attempt reports live status. */
	deliveryWorker?: OutboundDeliveryWorker;
}

/**
 * Build the tool for one engine invocation. The invocation pins the bot
 * and run identity server-side — the model cannot spoof either.
 */
export function createSendConnectorMessageTool(
	invocation: Pick<EngineInvocation, "botId" | "runId">,
	deps: SendConnectorMessageToolDeps,
): AgentTool<SendConnectorMessageInput, SendConnectorMessageOutput> {
	return {
		name: SEND_CONNECTOR_MESSAGE_TOOL,
		description:
			"Send a message to an external connector conversation (Telegram chat, Slack channel or thread). " +
			"Without a destination the message goes to the conversation this run originated from. " +
			"Explicit destinations must belong to this bot; destinations other than the originating " +
			"conversation require operator approval. Rate-limited per conversation.",
		inputSchema: {
			type: "object",
			properties: {
				text: {
					type: "string",
					description: "The message to send.",
				},
				connectorId: {
					type: "string",
					description:
						"Destination connector id (defaults to the originating connector).",
				},
				externalConversationId: {
					type: "string",
					description:
						"Destination conversation id (defaults to the originating conversation).",
				},
				externalAccountId: {
					type: "string",
					description:
						"Destination account id, required for destinations without a known route.",
				},
				idempotencyKey: {
					type: "string",
					description:
						"Optional dedupe key; retries with the same key never send twice.",
				},
			},
			required: ["text"],
			additionalProperties: false,
		},
		async execute(input, context) {
			const destination =
				input.connectorId || input.externalConversationId
					? {
							connectorId: (input.connectorId ?? "") as ConnectorId,
							externalConversationId: input.externalConversationId ?? "",
							...(input.externalAccountId
								? { externalAccountId: input.externalAccountId }
								: {}),
						}
					: undefined;
			if (
				destination &&
				(!destination.connectorId || !destination.externalConversationId)
			) {
				throw new Error(
					"An explicit destination needs both connectorId and externalConversationId",
				);
			}
			const idempotencyKey =
				input.idempotencyKey ??
				`proactive:${invocation.runId}:${context.toolCallId ?? "call"}`;
			const { record, created } = await deps.messenger.sendProactive({
				botId: invocation.botId as BotId,
				originRunId: invocation.runId as RunId,
				text: input.text,
				destination,
				idempotencyKey,
				requestedBy: `run:${invocation.runId}`,
			});
			// One immediate attempt so the model sees a live status; the
			// supervision worker keeps retrying transient failures afterwards.
			const fresh =
				(await deps.deliveryWorker?.deliverNow(record.outboundId)) ?? record;
			return {
				outboundId: fresh.outboundId,
				state: fresh.state,
				attempts: fresh.attempts,
				...(fresh.externalMessageIds
					? { externalMessageIds: fresh.externalMessageIds }
					: {}),
				...(fresh.lastError ? { lastError: fresh.lastError } : {}),
				created,
			};
		},
	};
}
