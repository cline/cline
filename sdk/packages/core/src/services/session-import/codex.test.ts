import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexImportAdapter } from "./codex";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function fixture(source: unknown = "vscode", messages: unknown[] = []) {
	const home = mkdtempSync(join(tmpdir(), "codex-history-"));
	tempDirs.push(home);
	mkdirSync(join(home, "sessions"));
	const write = (
		name: string,
		id: string,
		origin: unknown,
		items: unknown[],
	) => {
		writeFileSync(
			join(home, "sessions", `rollout-${name}.jsonl`),
			[
				{
					type: "session_meta",
					payload: { id, source: origin, cwd: "/workspace/demo" },
				},
				...items,
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n"),
		);
	};
	write("first", "thread", source, messages);
	return { home, write, adapter: new CodexImportAdapter({ codexHome: home }) };
}

function user(text: string) {
	return {
		type: "response_item",
		payload: {
			type: "message",
			role: "user",
			content: [{ type: "input_text", text }],
		},
	};
}
function event(message: string) {
	return { type: "event_msg", payload: { type: "user_message", message } };
}

const guardian =
	"The following is the Codex agent history whose request action you are assessing.";

describe("Codex import history regressions", () => {
	it.each([
		{ subagent: { other: "guardian" } },
		{ subagent: { thread_spawn: { parent_thread_id: "parent", depth: 1 } } },
	])("excludes internal source %j, including direct conversion", (source) => {
		const { adapter, write } = fixture(source, [
			user(guardian),
			event("Review the parser"),
		]);
		write("parent", "parent", "vscode", [user("Fix the parser")]);
		expect(adapter.discover().map((row) => row.sourceId)).toEqual(["parent"]);
		expect(() => adapter.convert("thread")).toThrow("not found");
	});

	it.each([
		"cli",
		"vscode",
		undefined,
	])("keeps top-level source %s", (source) => {
		const { adapter } = fixture(source, [user("Fix the parser")]);
		expect(adapter.discover()).toHaveLength(1);
		expect(adapter.convert("thread").title).toBe("Fix the parser");
	});

	it("skips plugin context in fallback discovery and conversion", () => {
		const { adapter } = fixture("vscode", [
			user("<recommended_plugins>catalogue</recommended_plugins>"),
			user("Fix the parser"),
		]);
		expect(adapter.discover()[0]).toMatchObject({
			title: "Fix the parser",
			preview: "Fix the parser",
			messageCount: 1,
		});
		const converted = adapter.convert("thread");
		expect(converted.title).toBe("Fix the parser");
		expect(converted.messages).toHaveLength(1);
		expect(converted.messages[0].content).toEqual([
			{ type: "text", text: "Fix the parser" },
		]);
	});

	it("does not discover plugin-context-only rollouts", () => {
		const { adapter } = fixture("vscode", [
			user("<recommended_plugins>catalogue</recommended_plugins>"),
		]);
		expect(adapter.discover()).toEqual([]);
	});

	it.each([
		user,
		event,
	])("cleans display text without changing the transcript (%#)", (message) => {
		const text =
			'<user_input mode="act">[external unsupported block: image] Fix the parser</user_input>';
		const { adapter } = fixture("vscode", [message(text)]);
		expect(adapter.discover()[0]).toMatchObject({
			title: "Fix the parser",
			preview: "Fix the parser",
		});
		const converted = adapter.convert("thread");
		expect(converted).toMatchObject({
			title: "Fix the parser",
			prompt: "Fix the parser",
		});
		expect(converted.messages[0].content).toEqual([{ type: "text", text }]);
	});

	it("prefers event prompts over earlier fallback items, matching conversion", () => {
		const { adapter } = fixture("vscode", [
			user("Earlier replay context"),
			event("Actual typed request"),
			event("Follow-up"),
		]);
		expect(adapter.discover()[0].title).toBe("Actual typed request");
		expect(adapter.convert("thread").prompt).toBe("Actual typed request");
	});

	it("preserves explicit Codex titles and deduplicates resumed rollouts", () => {
		const { adapter, home, write } = fixture("cli", [user("First request")]);
		write("resumed", "thread", "cli", [
			user("First request"),
			user("Second request"),
		]);
		writeFileSync(
			join(home, "session_index.jsonl"),
			JSON.stringify({ id: "thread", thread_name: "My custom title" }),
		);
		expect(adapter.discover()).toHaveLength(1);
		expect(adapter.discover()[0].title).toBe("My custom title");
		expect(adapter.convert("thread").title).toBe("My custom title");
		expect(adapter.convert("thread").messages).toHaveLength(2);
	});
});
