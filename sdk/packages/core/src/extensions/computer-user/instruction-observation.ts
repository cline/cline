import {
	type AgentHooks,
	type AgentMessage,
	validateImageMedia,
} from "@cline/shared";
import type { ComputerUseClient } from "../computer-use/client";
import { formatComputerObservation } from "../computer-use/observation";

function latestStateChangingComputerResultId(
	messages: readonly AgentMessage[],
): string | undefined {
	const toolActions = new Map<string, unknown>();
	for (const message of messages) {
		for (const part of message.content) {
			if (part.type === "tool-call" && part.toolName === "computer") {
				const input =
					part.input && typeof part.input === "object"
						? (part.input as Record<string, unknown>)
						: undefined;
				toolActions.set(part.toolCallId, input?.action);
			}
		}
	}
	for (const message of [...messages].reverse()) {
		if (
			message.content.some(
				(part) =>
					part.type === "tool-result" &&
					part.toolName === "computer" &&
					toolActions.get(part.toolCallId) !== "cursor_position",
			)
		) {
			return message.id;
		}
	}
	return undefined;
}

/**
 * Capture at instruction consumption, not enqueue time: steering can arrive
 * while a computer sequence is still running. The runtime invokes beforeModel
 * after tools settle and pending instructions are consumed. The shared client
 * makes this image the backend's guard reference before the model can act.
 * Each helper session owns its hook and cache; replacement cannot reuse them.
 */
export function createComputerInstructionObservationHooks(
	client: ComputerUseClient,
): AgentHooks {
	let cached:
		| {
				runId: string | undefined;
				instructionId: string;
				previousStateChangingResultId: string | undefined;
				message: AgentMessage | undefined;
		  }
		| undefined;

	return {
		beforeModel: async ({ snapshot, request }) => {
			const newestFirst = [...snapshot.messages].reverse();
			const instruction = newestFirst.find(
				(message) =>
					message.role === "user" && message.metadata?.displayRole !== "system",
			);
			if (!instruction) return undefined;
			const latestStateChangingResultId = latestStateChangingComputerResultId(
				snapshot.messages,
			);

			request.signal?.throwIfAborted();
			if (
				!cached ||
				cached.runId !== snapshot.runId ||
				cached.instructionId !== instruction.id
			) {
				const response = await client.send(
					{ action: "screenshot" },
					{ signal: request.signal },
				);
				request.signal?.throwIfAborted();
				if (
					!response.ok ||
					!response.image ||
					typeof response.image.data !== "string" ||
					typeof response.image.mediaType !== "string"
				) {
					throw new Error(
						response.error ??
							"Computer-use backend did not return the instruction screenshot",
					);
				}
				const image = validateImageMedia(
					response.image.mediaType,
					response.image.data,
				);
				if (!image.ok) {
					throw new Error(
						`Instruction screenshot is unusable: ${image.message}`,
					);
				}
				cached = {
					runId: snapshot.runId,
					instructionId: instruction.id,
					previousStateChangingResultId: latestStateChangingResultId,
					message: {
						id: `computer-observation-${snapshot.runId}-${instruction.id}`,
						role: "user",
						createdAt: Date.now(),
						content: formatComputerObservation(
							{
								...response,
								image: { data: image.base64, mediaType: image.mediaType },
							},
							"Automatically captured for the latest instruction. The driver has not inspected this attachment; it is shown to you, not to the driver by this handoff. Inspect it before acting; do not request another screenshot merely to begin.",
						),
					},
				};
			}

			// Keep the instruction image across read-only work, but never replay
			// pre-action pixels after a state-changing computer result. Older
			// backends may omit the replacement screenshot, so result identity—not
			// image presence—is the consistency boundary.
			if (
				latestStateChangingResultId !== cached.previousStateChangingResultId
			) {
				// Release superseded pixels permanently, even if compaction later
				// removes the tool result that superseded them.
				cached.message = undefined;
			}
			return cached.message
				? { messages: [...request.messages, cached.message] }
				: undefined;
		},
	};
}
