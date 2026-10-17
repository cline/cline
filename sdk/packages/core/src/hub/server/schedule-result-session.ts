import type { ToolApprovalRequest } from "@cline/shared";
import type { HubTransportContext } from "./handlers/context";
import { handleSessionCreate } from "./handlers/session-handlers";
import type { HubRunRecord } from "./hub-run-queue";

export const SCHEDULE_RESULT_RUN_PREFIX = "schedule-result:";

export async function prepareScheduleResultSession(
	ctx: HubTransportContext,
	run: HubRunRecord,
	requestToolApproval: (
		request: ToolApprovalRequest,
	) => Promise<{ approved: boolean; reason?: string }>,
): Promise<void> {
	if (!run.runId.startsWith(SCHEDULE_RESULT_RUN_PREFIX)) return;
	const session = await ctx.sessionHost.getSession(run.sessionId);
	if (!session)
		throw new Error(
			`Scheduled result destination was deleted: ${run.sessionId}`,
		);
	const [initialMessages, initialCompactionState] = await Promise.all([
		ctx.sessionHost.readSessionMessages(run.sessionId),
		ctx.sessionHost.readSessionCompactionState(run.sessionId),
	]);
	const metadata = session.metadata ?? {};
	const reply = await handleSessionCreate(
		ctx,
		{
			version: "v1",
			command: "session.create",
			sessionId: run.sessionId,
			payload: {
				initialMessages,
				initialCompactionState,
				metadata: { ...metadata, source: session.source, interactive: true },
				sessionConfig: {
					sessionId: run.sessionId,
					providerId: session.provider,
					modelId: session.model,
					cwd: session.cwd,
					workspaceRoot: session.workspaceRoot,
					enableTools: session.enableTools,
					enableSpawnAgent: session.enableSpawn,
					enableAgentTeams: session.enableTeams,
					mode:
						metadata.mode === "plan" || metadata.mode === "yolo"
							? metadata.mode
							: "act",
					...(typeof metadata.systemPrompt === "string"
						? { systemPrompt: metadata.systemPrompt }
						: {}),
				},
				toolPolicies: {
					"*": { autoApprove: metadata.autoApproveTools === true },
				},
				runtimeOptions: {
					autoApproveTools: metadata.autoApproveTools === true,
				},
			},
		},
		requestToolApproval,
		{ resumeExistingSession: true },
	);
	if (!reply.ok)
		throw new Error(
			reply.error?.message ?? "Could not resume scheduled result destination",
		);
}
