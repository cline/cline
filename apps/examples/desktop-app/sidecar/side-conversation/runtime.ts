import {
	type ClineCore,
	createSideHistoryTool,
	SIDE_SCOPE_INSTRUCTIONS,
	type StartSessionInput,
} from "@cline/core";
import { readSideConversation } from "../../shared/side-conversation";
import { cancelSidecarSessionInteractions } from "../context";
import type { SidecarContext } from "../types";
import {
	assertSideConversationAvailable,
	deleteTemporarySideConversation,
} from "./lifecycle";

export async function startSessionWithSidePolicy(
	ctx: SidecarContext,
	manager: ClineCore,
	input: StartSessionInput,
) {
	const side = readSideConversation(input.sessionMetadata);
	const sessionId = input.config.sessionId ?? "";
	assertSideConversationAvailable(ctx, sessionId, input.sessionMetadata);
	const result = await manager.start(
		side
			? {
					...input,
					config: {
						...input.config,
						enableSpawnAgent: false,
						enableAgentTeams: false,
						systemPrompt: `${input.config.systemPrompt ?? ""}\n\n${SIDE_SCOPE_INSTRUCTIONS}`,
					},
					localRuntime: {
						...input.localRuntime,
						extraTools: [
							...(input.localRuntime?.extraTools ?? []),
							createSideHistoryTool({
								manager,
								parentSessionId: side.parentSessionId,
							}),
						],
					},
					toolPolicies: { ...input.toolPolicies, tasks: { enabled: false } },
				}
			: input,
	);
	try {
		assertSideConversationAvailable(
			ctx,
			result.sessionId,
			input.sessionMetadata,
		);
	} catch (error) {
		if (side) {
			ctx.temporarySideConversations.closed.add(result.sessionId);
			await cancelSidecarSessionInteractions(
				ctx,
				result.sessionId,
				"Side chat ended",
			);
			await deleteTemporarySideConversation(manager, result.sessionId);
		}
		throw error;
	}
	return result;
}
