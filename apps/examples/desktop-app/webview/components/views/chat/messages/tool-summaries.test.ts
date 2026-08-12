import { buildGroupedToolLabel } from "@cline/ui/components/agent-chat/tool-summary";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	buildToolPresentation,
	formatToolValue,
	parseToolPayload,
} from "./tool-summaries";

// Label/parser/team behavior lives in the shared module and is covered by
// sdk/packages/ui/tests/tool-summary.test.ts; these tests cover the app-local
// layer: payload parsing, hook-event conventions, and display formatting.

function makeToolMessage(
	payload: unknown,
	overrides: Partial<ChatMessage> = {},
): ChatMessage {
	return {
		id: "tool-1",
		sessionId: "session-1",
		role: "tool",
		content: typeof payload === "string" ? payload : JSON.stringify(payload),
		createdAt: 1,
		...overrides,
	} as ChatMessage;
}

describe("parseToolPayload", () => {
	it("parses JSON payloads and rejects non-JSON content", () => {
		expect(parseToolPayload('{"toolName":"read_files"}')).toEqual({
			toolName: "read_files",
		});
		expect(parseToolPayload("not-json")).toBeNull();
	});
});

describe("formatToolValue", () => {
	it("passes plain strings through", () => {
		expect(formatToolValue("hello")).toBe("hello");
	});

	it("re-parses JSON strings and surfaces error fields", () => {
		expect(formatToolValue('{"error":"boom"}')).toBe("boom");
		expect(formatToolValue({ error: "broken" })).toBe("broken");
	});

	it("pretty-prints structured values and hides null/undefined", () => {
		expect(formatToolValue({ a: 1 })).toBe('{\n  "a": 1\n}');
		expect(formatToolValue(null)).toBe("");
		expect(formatToolValue(undefined)).toBe("");
	});
});

describe("buildToolPresentation", () => {
	it("marks a payload without a result as in progress", () => {
		const presentation = buildToolPresentation(
			makeToolMessage({ toolName: "read_files", input: {}, result: null }),
		);
		expect(presentation.inProgress).toBe(true);
		expect(presentation.toolName).toBe("read_files");
	});

	it("prefers the meta tool name and falls back to kind labels for unparseable payloads", () => {
		const presentation = buildToolPresentation(
			makeToolMessage("not-json", {
				content: "not-json",
				meta: { toolName: "search" },
			}),
		);
		expect(presentation.payload).toBeNull();
		expect(presentation.summary.kind).toBe("search");
		expect(presentation.summary.label).toBe("Searched");
	});

	it("treats tool_call_start hook events as in progress", () => {
		const presentation = buildToolPresentation(
			makeToolMessage(
				{ toolName: "run_commands", input: {}, result: { ok: true } },
				{
					meta: { toolName: "run_commands", hookEventName: "tool_call_start" },
				},
			),
		);
		expect(presentation.inProgress).toBe(true);
	});

	it("flags errored payloads and extracts error text", () => {
		const presentation = buildToolPresentation(
			makeToolMessage({
				toolName: "run_commands",
				input: { commands: ["bun run deploy"] },
				isError: true,
				result: { error: "exit code 1" },
			}),
		);
		expect(presentation.inProgress).toBe(false);
		expect(presentation.summary.errorText).toBe("exit code 1");
	});
});

describe("buildGroupedToolLabel over presentations", () => {
	function presentationFor(payload: {
		toolName: string;
		input?: unknown;
		result?: unknown;
	}) {
		return buildToolPresentation(
			makeToolMessage({ result: {}, ...payload }, { id: payload.toolName }),
		);
	}

	function toGroupInput(presentation: {
		summary: { label: string; aggregate?: unknown };
		inProgress: boolean;
	}) {
		return {
			label: presentation.summary.label,
			aggregate: presentation.summary.aggregate as never,
			inProgress: presentation.inProgress,
		};
	}

	it("returns the single summary label untouched", () => {
		const only = presentationFor({
			toolName: "read_files",
			input: { paths: ["a.ts"] },
		});
		expect(buildGroupedToolLabel([toGroupInput(only)])).toBe("Read file a.ts");
	});

	it("merges consecutive aggregates that share a key", () => {
		const first = presentationFor({
			toolName: "read_files",
			input: { paths: ["a.ts", "b.ts"] },
		});
		const second = presentationFor({
			toolName: "read_files",
			input: { paths: ["c.ts"] },
		});
		expect(
			buildGroupedToolLabel([toGroupInput(first), toGroupInput(second)]),
		).toBe("Read 3 files");
	});

	it("joins non-mergeable segments with separators and keeps progress verbs", () => {
		const reads = presentationFor({
			toolName: "read_files",
			input: { paths: ["a.ts", "b.ts"] },
		});
		const running = buildToolPresentation(
			makeToolMessage(
				{
					toolName: "run_commands",
					input: { commands: ["bun test"] },
					result: null,
				},
				{ id: "cmd" },
			),
		);
		expect(
			buildGroupedToolLabel([toGroupInput(reads), toGroupInput(running)]),
		).toBe("Read 2 files · Running 1 command");
	});
});
