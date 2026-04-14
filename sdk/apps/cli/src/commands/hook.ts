import { createInterface } from "node:readline";
import type { HookEventPayload, RunHookResult } from "@clinebot/core";
import {
	appendHookAudit,
	parseCliHookPayload,
	readStdinUtf8,
	truncate,
	writeHookJson,
} from "../utils/helpers";
import { getCoreSessionBackend } from "../utils/session";

interface HookWorkerRequest {
	id: string;
	payload: unknown;
}

interface HookWorkerResponse {
	id: string;
	ok: boolean;
	result?: RunHookResult;
	error?: string;
}

async function handleHookPayload(payload: HookEventPayload): Promise<unknown> {
	appendHookAudit(payload);
	const shouldTouchSessions =
		payload.hookName === "tool_call" || !!payload.parent_agent_id;
	if (shouldTouchSessions) {
		const sessions = await getCoreSessionBackend();
		await sessions.queueSpawnRequest(payload);
		const subSessionId = await sessions.upsertSubagentSessionFromHook(payload);
		if (subSessionId) {
			await sessions.appendSubagentHookAudit(subSessionId, payload);
			if (payload.hookName === "tool_call") {
				await sessions.appendSubagentTranscriptLine(
					subSessionId,
					`[tool] ${payload.tool_call?.name ?? "unknown"}`,
				);
			}
			if (payload.hookName === "agent_end") {
				await sessions.appendSubagentTranscriptLine(
					subSessionId,
					"[done] completed",
				);
			}
			if (payload.hookName === "session_shutdown") {
				await sessions.appendSubagentTranscriptLine(
					subSessionId,
					`[shutdown] ${payload.reason ?? "session shutdown"}`,
				);
			}
			await sessions.applySubagentStatus(subSessionId, payload);
		}
	}

	switch (payload.hookName) {
		case "tool_call":
		case "tool_result":
		case "agent_end":
		case "agent_start":
		case "agent_resume":
		case "agent_abort":
		case "prompt_submit":
		case "pre_compact":
		case "session_shutdown":
			return {};
		default:
			throw new Error(
				`unsupported hookName: ${(payload as { hookName: string }).hookName}`,
			);
	}
}

function toHookResult(value: unknown): RunHookResult {
	return {
		exitCode: 0,
		stdout: "",
		stderr: "",
		parsedJson: value,
	};
}

function parseWorkerRequest(raw: string): HookWorkerRequest {
	const parsed = JSON.parse(raw) as HookWorkerRequest;
	if (!parsed || typeof parsed.id !== "string" || !parsed.id.trim()) {
		throw new Error("invalid hook worker request id");
	}
	return parsed;
}

function encodeWorkerResponse(response: HookWorkerResponse): string {
	return `${JSON.stringify(response)}\n`;
}

type HookIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

export async function runHookCommand(io: HookIo) {
	try {
		const raw = (await readStdinUtf8()).trim();
		if (!raw) {
			io.writeErr("hook command expects JSON payload on stdin");
			return 1;
		}

		const parsed = JSON.parse(raw) as unknown;
		const payload = parseCliHookPayload(parsed);
		if (!payload) {
			io.writeErr("invalid hook payload");
			return 1;
		}

		writeHookJson(await handleHookPayload(payload));
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

export async function runHookWorkerCommand(writeErr: (text: string) => void) {
	const rl = createInterface({
		input: process.stdin,
		crlfDelay: Infinity,
		terminal: false,
	});

	try {
		for await (const line of rl) {
			const raw = line.trim();
			if (!raw) {
				continue;
			}
			let request: HookWorkerRequest;
			try {
				request = parseWorkerRequest(raw);
			} catch (error) {
				process.stdout.write(
					encodeWorkerResponse({
						id: "unknown",
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
				continue;
			}

			try {
				const payload = parseCliHookPayload(request.payload);
				if (!payload) {
					throw new Error("invalid hook payload");
				}
				process.stdout.write(
					encodeWorkerResponse({
						id: request.id,
						ok: true,
						result: toHookResult(await handleHookPayload(payload)),
					}),
				);
			} catch (error) {
				process.stdout.write(
					encodeWorkerResponse({
						id: request.id,
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			}
		}
		return 0;
	} catch (error) {
		writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	} finally {
		rl.close();
	}
}

export function formatHookDispatchOutput(result?: RunHookResult): string {
	const value = result?.parsedJson;
	if (value === undefined || value === null) {
		return "";
	}
	if (
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value as Record<string, unknown>).length === 0
	) {
		return "";
	}
	if (typeof value === "string") {
		return truncate(value, 100);
	}
	return truncate(JSON.stringify(value), 100);
}
