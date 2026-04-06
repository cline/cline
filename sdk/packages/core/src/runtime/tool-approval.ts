import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolApprovalRequest, ToolApprovalResult } from "@clinebot/shared";

export type DesktopToolApprovalOptions = {
	approvalDir?: string;
	sessionId?: string;
	timeoutMs?: number;
	pollIntervalMs?: number;
	nowIso?: () => string;
};

function sanitizeApprovalToken(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestDesktopToolApproval(
	request: ToolApprovalRequest,
	options: DesktopToolApprovalOptions = {},
): Promise<ToolApprovalResult> {
	const approvalDir = options.approvalDir?.trim();
	const sessionId = options.sessionId?.trim();
	if (!approvalDir || !sessionId) {
		return {
			approved: false,
			reason: "Desktop tool approval IPC is not configured",
		};
	}

	await mkdir(approvalDir, { recursive: true });
	const requestId = sanitizeApprovalToken(`${request.toolCallId}`);
	const requestPath = join(
		approvalDir,
		`${sessionId}.request.${requestId}.json`,
	);
	const decisionPath = join(
		approvalDir,
		`${sessionId}.decision.${requestId}.json`,
	);
	const nowIso = options.nowIso ?? (() => new Date().toISOString());

	await writeFile(
		requestPath,
		`${JSON.stringify(
			{
				requestId,
				sessionId,
				createdAt: nowIso(),
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				input: request.input,
				iteration: request.iteration,
				agentId: request.agentId,
				conversationId: request.conversationId,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	const timeoutMs = options.timeoutMs ?? 5 * 60_000;
	const pollIntervalMs = options.pollIntervalMs ?? 200;
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const raw = await readFile(decisionPath, "utf8");
			const parsed = JSON.parse(raw) as {
				approved?: boolean;
				reason?: string;
			};
			const result = {
				approved: parsed.approved === true,
				reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
			};
			try {
				await unlink(decisionPath);
			} catch {
				// Best-effort cleanup.
			}
			try {
				await unlink(requestPath);
			} catch {
				// Best-effort cleanup.
			}
			return result;
		} catch {
			// Decision not available yet.
		}
		await delay(pollIntervalMs);
	}

	try {
		await unlink(requestPath);
	} catch {
		// Best-effort cleanup.
	}

	return { approved: false, reason: "Tool approval request timed out" };
}
