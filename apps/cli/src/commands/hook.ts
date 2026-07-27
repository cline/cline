import type { HookEventPayload } from "@cline/core";
import { handleSessionHookEvent } from "../session/session";
import {
	appendHookAudit,
	parseCliHookPayload,
	readStdinUtf8,
	writeHookJson,
} from "../utils/helpers";

async function handleHookPayload(payload: HookEventPayload): Promise<unknown> {
	await appendHookAudit(payload);
	await handleSessionHookEvent(payload);

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
		const payload = await parseCliHookPayload(parsed);
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
