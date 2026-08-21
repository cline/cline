import { describe, expect, it } from "vitest";
import {
	BRIDGE_COMMAND_NAMES,
	BRIDGE_PROTOCOL_VERSION,
	BridgeCommandSchema,
	containsForbiddenControlChars,
	MAX_BRIDGE_FRAME_BYTES,
	MAX_PROMPT_BYTES,
	parseWebviewFrame,
} from "./bridge";

const REQUEST_ID = "req_0123456789";

function commandFrame(payload: unknown): string {
	return JSON.stringify({
		v: BRIDGE_PROTOCOL_VERSION,
		type: "command",
		id: "frame_1",
		payload,
	});
}

describe("bridge command schema (closed set)", () => {
	it("accepts every documented command", () => {
		const samples: Record<(typeof BRIDGE_COMMAND_NAMES)[number], unknown> = {
			"app.initialize": { command: "app.initialize" },
			"gateway.reconnect": { command: "gateway.reconnect" },
			"bot.select": { command: "bot.select", botId: "bot_1" },
			"workspace.select": {
				command: "workspace.select",
				workspaceId: "workspace-managed",
			},
			"workspace.open": { command: "workspace.open" },
			"session.select": { command: "session.select", sessionId: "ses_1" },
			"run.start": {
				command: "run.start",
				clientRequestId: REQUEST_ID,
				botId: "bot_1",
				prompt: "hello",
			},
			"run.steer": {
				command: "run.steer",
				clientRequestId: REQUEST_ID,
				runId: "run_1",
				text: "change course",
			},
			"run.interrupt": {
				command: "run.interrupt",
				clientRequestId: REQUEST_ID,
				runId: "run_1",
			},
			"run.abort": {
				command: "run.abort",
				clientRequestId: REQUEST_ID,
				runId: "run_1",
			},
			"run.retry": {
				command: "run.retry",
				clientRequestId: REQUEST_ID,
				runId: "run_1",
			},
			"approval.resolve": {
				command: "approval.resolve",
				clientRequestId: REQUEST_ID,
				requestId: "srq_1",
				approved: true,
			},
			"diagnostics.reveal": { command: "diagnostics.reveal" },
		};
		for (const name of BRIDGE_COMMAND_NAMES) {
			expect(
				BridgeCommandSchema.safeParse(samples[name]).success,
				`command ${name} should validate`,
			).toBe(true);
		}
	});

	it("rejects unknown commands — there is no generic invoke", () => {
		expect(
			BridgeCommandSchema.safeParse({
				command: "gateway.invoke",
				method: "run.start",
				payload: {},
			}).success,
		).toBe(false);
		expect(
			BridgeCommandSchema.safeParse({ command: "fs.read", path: "/etc" })
				.success,
		).toBe(false);
	});

	it("rejects extra fields on known commands (strict schemas)", () => {
		expect(
			BridgeCommandSchema.safeParse({
				command: "run.start",
				clientRequestId: REQUEST_ID,
				botId: "bot_1",
				prompt: "hello",
				workspaceRoot: "/etc/passwd",
			}).success,
		).toBe(false);
	});

	it("caps prompts at 256 KiB", () => {
		const oversized = "x".repeat(MAX_PROMPT_BYTES + 1);
		expect(
			BridgeCommandSchema.safeParse({
				command: "run.start",
				clientRequestId: REQUEST_ID,
				botId: "bot_1",
				prompt: oversized,
			}).success,
		).toBe(false);
		expect(
			BridgeCommandSchema.safeParse({
				command: "run.steer",
				clientRequestId: REQUEST_ID,
				runId: "run_1",
				text: oversized,
			}).success,
		).toBe(false);
	});

	it("rejects NUL and control characters in prompt text", () => {
		expect(containsForbiddenControlChars("hello\u0000world")).toBe(true);
		expect(containsForbiddenControlChars("hello\u001bworld")).toBe(true);
		expect(containsForbiddenControlChars("multi\nline\ttext\r\n")).toBe(false);
		expect(
			BridgeCommandSchema.safeParse({
				command: "run.start",
				clientRequestId: REQUEST_ID,
				botId: "bot_1",
				prompt: "bad\u0000prompt",
			}).success,
		).toBe(false);
	});

	it("requires idempotent client request IDs on mutations", () => {
		expect(
			BridgeCommandSchema.safeParse({
				command: "run.start",
				clientRequestId: "short",
				botId: "bot_1",
				prompt: "hello",
			}).success,
		).toBe(false);
	});
});

describe("frame parsing", () => {
	it("parses authenticate and command frames", () => {
		const auth = parseWebviewFrame(
			JSON.stringify({
				v: BRIDGE_PROTOCOL_VERSION,
				type: "authenticate",
				secret: "some-launch-secret",
			}),
		);
		expect(auth.kind).toBe("authenticate");
		const command = parseWebviewFrame(
			commandFrame({ command: "app.initialize" }),
		);
		expect(command.kind).toBe("command");
	});

	it("rejects frames above 1 MiB", () => {
		const big = commandFrame({
			command: "run.start",
			clientRequestId: REQUEST_ID,
			botId: "bot_1",
			prompt: "x".repeat(MAX_BRIDGE_FRAME_BYTES),
		});
		const parsed = parseWebviewFrame(big);
		expect(parsed.kind).toBe("invalid");
		if (parsed.kind === "invalid") {
			expect(parsed.reason).toContain("exceeds");
		}
	});

	it("rejects non-JSON and unknown frame shapes", () => {
		expect(parseWebviewFrame("not json").kind).toBe("invalid");
		expect(
			parseWebviewFrame(JSON.stringify({ v: 1, type: "eval", code: "1+1" }))
				.kind,
		).toBe("invalid");
	});
});
