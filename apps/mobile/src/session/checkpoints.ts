import type { HubClient } from "@cline/hub-client";
import { z } from "zod";
import { ASK_QUESTION_CAPABILITY } from "./schemas";

const checkpointSchema = z.object({
	ref: z.string().min(1),
	createdAt: z.number().finite(),
	runCount: z.number().int().positive(),
	kind: z.enum(["stash", "commit"]).optional(),
});
export type SessionCheckpoint = z.infer<typeof checkpointSchema>;
const recordSchema = z.looseObject({
	sessionId: z.string().min(1),
	workspaceRoot: z.string().optional(),
	cwd: z.string().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	status: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	runtimeOptions: z.record(z.string(), z.unknown()).optional(),
});

async function readRecord(client: HubClient, sessionId: string) {
	const reply = await client.command("session.get", { sessionId }, sessionId);
	const parsed = recordSchema.safeParse(reply.payload?.session);
	if (!parsed.success || parsed.data.sessionId !== sessionId)
		throw new Error("The original conversation could not be read.");
	return parsed.data;
}
function checkpoints(
	record: z.infer<typeof recordSchema>,
): SessionCheckpoint[] {
	const checkpoint = record.metadata?.checkpoint as
		| { history?: unknown }
		| undefined;
	const history = Array.isArray(checkpoint?.history) ? checkpoint.history : [];
	return history
		.flatMap((entry) => {
			const parsed = checkpointSchema.safeParse(entry);
			return parsed.success ? [parsed.data] : [];
		})
		.sort((a, b) => b.runCount - a.runCount);
}
export async function listSessionCheckpoints(
	client: HubClient,
	sessionId: string,
) {
	return checkpoints(await readRecord(client, sessionId));
}

/** Fork only the conversation; workspace rollback requires host-side coordination. */
export async function checkpointForkInput(
	client: HubClient,
	sessionId: string,
	runCount: number,
) {
	const saved = await readRecord(client, sessionId);
	if (["running", "pending"].includes(saved.status ?? ""))
		throw new Error("Wait for this conversation to finish before forking.");
	if (
		!checkpoints(saved).some((checkpoint) => checkpoint.runCount === runCount)
	)
		throw new Error(
			"This checkpoint is no longer available. Refresh and try again.",
		);
	const metadata = saved.metadata ?? {};
	const runtime = saved.runtimeOptions ?? {};
	const mode = runtime.mode ?? metadata.mode ?? "act";
	if (mode !== "act" && mode !== "plan" && mode !== "yolo")
		throw new Error("The saved conversation mode is not supported.");
	const providerId = saved.provider ?? metadata.provider;
	const modelId = saved.model ?? metadata.model;
	const systemPrompt = runtime.systemPrompt ?? metadata.systemPrompt;
	if (
		typeof providerId !== "string" ||
		typeof modelId !== "string" ||
		typeof systemPrompt !== "string"
	)
		throw new Error(
			"This conversation is missing settings needed to fork safely.",
		);
	return {
		sessionId,
		restore: {
			messages: true,
			workspace: false,
			omitCheckpointMessageFromSession: true,
		},
		checkpointRunCount: runCount,
		workspaceRoot: saved.workspaceRoot,
		cwd: saved.cwd,
		sessionConfig: {
			providerId,
			modelId,
			systemPrompt,
			mode,
			workspaceRoot: saved.workspaceRoot,
			cwd: saved.cwd,
			checkpoint: { enabled: true },
			compaction: { enabled: true },
			...(typeof metadata.thinking === "boolean"
				? { thinking: metadata.thinking }
				: {}),
			...(typeof metadata.reasoningEffort === "string"
				? { reasoningEffort: metadata.reasoningEffort }
				: {}),
			...(typeof metadata.thinkingBudgetTokens === "number"
				? { thinkingBudgetTokens: metadata.thinkingBudgetTokens }
				: {}),
		},
		metadata: {
			interactive: true,
			source: "mobile",
			forkedFromSessionId: sessionId,
		},
		runtimeOptions: {
			...runtime,
			clientContributions: [
				{
					kind: "toolExecutor",
					executor: "askQuestion",
					capabilityName: ASK_QUESTION_CAPABILITY,
				},
			],
		},
		// A copied conversation starts with approvals, even if its source opted out.
		toolPolicies: { "*": { autoApprove: false } },
	};
}
