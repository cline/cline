import type { HubClient } from "@cline/hub-client";
import { isSessionNotFoundError } from "@cline/shared";
import { z } from "zod";
import { parseSessionCreateReply } from "./schemas";

const savedReplySchema = z.object({
	session: z.looseObject({
		sessionId: z.string().min(1),
		cwd: z.string().optional(),
		workspaceRoot: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		runtimeOptions: z.record(z.string(), z.unknown()).optional(),
	}),
});

/** Same saved-task restoration contract as desktop PR #14501; no new task or prompt. */
export async function restoreCloudSession(
	client: HubClient,
	sessionId: string,
	modelId?: string,
	signal?: AbortSignal,
): Promise<void> {
	const assertCurrent = () => {
		if (signal?.aborted)
			throw signal.reason ?? new Error("Cloud startup cancelled.");
	};
	const probe = () =>
		client.command(
			"session.update_connection",
			{ sessionId, updates: {} },
			sessionId,
		);
	assertCurrent();
	try {
		await probe();
		return;
	} catch (error) {
		if (
			!isSessionNotFoundError(error) &&
			!(
				error instanceof Error &&
				(error as Error & { code?: string }).code === "command_failed" &&
				error.message === `session not found: ${sessionId}`
			)
		)
			throw error;
	}
	assertCurrent();
	const reply = await client.command("session.get", { sessionId }, sessionId);
	const parsed = savedReplySchema.safeParse(reply.payload);
	if (!parsed.success || parsed.data.session.sessionId !== sessionId)
		throw new Error("The saved conversation could not be restored. Try again.");
	assertCurrent();
	const history = await client.command("session.messages", {}, sessionId);
	const initialMessages = history.payload?.messages;
	if (!Array.isArray(initialMessages) || initialMessages.length === 0)
		throw new Error("The saved conversation is empty or unavailable.");
	assertCurrent();
	const saved = parsed.data.session;
	const metadata = saved.metadata ?? {};
	const runtimeOptions = saved.runtimeOptions ?? {};
	const workspaceRoot = saved.workspaceRoot ?? "/workspace";
	const cwd = saved.cwd ?? workspaceRoot;
	try {
		const restored = await client.command("session.create", {
			workspaceRoot,
			cwd,
			initialMessages,
			metadata: { ...metadata, interactive: true },
			sessionConfig: {
				sessionId,
				workspaceRoot,
				cwd,
				providerId: metadata.provider ?? "cline",
				modelId: metadata.model ?? metadata.modelId ?? modelId,
				systemPrompt:
					runtimeOptions.systemPrompt ?? metadata.systemPrompt ?? "",
				mode: runtimeOptions.mode ?? metadata.mode ?? "act",
				...(typeof metadata.thinking === "boolean"
					? { thinking: metadata.thinking }
					: {}),
				...(typeof metadata.reasoningEffort === "string"
					? { reasoningEffort: metadata.reasoningEffort }
					: {}),
				...(metadata.checkpointEnabled === true
					? { checkpoint: { enabled: true } }
					: {}),
			},
			runtimeOptions,
			// Cloud defaults to auto-approval, as on desktop. Respect an explicit
			// saved opt-out instead of silently broadening that session's policy.
			toolPolicies: {
				"*": {
					autoApprove:
						metadata.autoApproveTools !== false &&
						runtimeOptions.autoApproveTools !== false,
				},
			},
		});
		assertCurrent();
		const result = parseSessionCreateReply(restored.payload);
		if (result.status !== "ok" || result.sessionId !== sessionId)
			throw new Error("Cloud Hub did not restore the requested conversation.");
	} catch (error) {
		if ((error as { code?: string })?.code !== "session_already_exists")
			throw error;
		assertCurrent();
		await probe();
	}
}
