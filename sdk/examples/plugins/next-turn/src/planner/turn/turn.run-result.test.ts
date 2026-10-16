import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	Agent,
	CommandExitError,
	createApplyPatchExecutor,
	createDefaultTools,
	createEditorExecutor,
} from "@cline/core";
import type { AgentMessage } from "@cline/shared";
import { TURN_TEXT_LIMIT } from "../../config";
import { type Model, message, runResult } from "../../test-support/agent-runs";
import { useTempDirs } from "../../test-support/temp-dirs";
import { lastPersonMessage } from "./run-count";
import { editedPaths } from "./tool-calls";
import { deriveTurn } from "./turn";

const tempDir = useTempDirs("next-turn-turn-");

/** Makes `calls` together on its first request, then answers in text. */
function callingModel(
	calls: ReadonlyArray<readonly [toolName: string, input: unknown]>,
): Model {
	let requests = 0;
	return {
		async *stream() {
			requests += 1;
			if (requests === 1) {
				for (const [index, [toolName, input]] of calls.entries())
					yield {
						type: "tool-call-delta",
						index,
						toolCallId: `c${index}`,
						toolName,
						input,
					};
				yield { type: "finish", reason: "tool-calls" };
			} else {
				yield { type: "text-delta", text: "Done." };
				yield { type: "finish", reason: "stop" };
			}
		},
	};
}

describe("the turn, from the run result", () => {
	const earlier = [
		message("user", "First request"),
		message("assistant", "ok"),
	];

	test("facts and context come only from after the person's last message", () => {
		const user = message("user", "Fix the failing test in users.test.ts");
		const messages = [
			...earlier,
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "old",
					toolName: "editor",
					input: { path: "old.ts" },
				},
			]),
			user,
			message("user", "<hook_context>injected</hook_context>", {
				metadata: { userRunSpan: 0, displayRole: "system" },
			}),
			message(
				"assistant",
				[
					{
						type: "tool-call",
						toolCallId: "c1",
						toolName: "editor",
						input: { path: "src/users.ts" },
					},
					{
						type: "tool-call",
						toolCallId: "c2",
						toolName: "apply_patch",
						input: { input: "*** Update File: a.ts\n*** Add File: b.ts\n" },
					},
					{
						type: "tool-call",
						toolCallId: "c3",
						toolName: "run_commands",
						input: { command: "git push -u origin feature" },
					},
				],
				{ modelInfo: { id: "claude-sonnet-5-5", provider: "anthropic" } },
			),
			message("tool", [
				{
					type: "tool-result",
					toolCallId: "c1",
					toolName: "editor",
					output: "ok",
				},
				{
					type: "tool-result",
					toolCallId: "c3",
					toolName: "run_commands",
					output: { error: "token=abcdefghijklmnopqr rejected" },
					isError: true,
				},
			]),
		];
		const turn = deriveTurn(
			"s1",
			runResult(messages, { runId: "run_si9HsPkJ" }),
		);
		expect(turn).toMatchObject({
			runId: "run_si9HsPkJ",
			userMessageId: user.id,
			runCount: 2,
			turnKey: "s1:2",
			facts: { status: "completed", filesEdited: 3, toolErrored: true },
			pushed: false,
			chat: { providerId: "anthropic", modelId: "claude-sonnet-5-5" },
		});
		expect(turn?.context.request).toBe("Fix the failing test in users.test.ts");
		expect(turn?.context.editedPaths).toEqual(["src/users.ts", "a.ts", "b.ts"]);
		expect(turn?.context.tools).toEqual([
			{ name: "editor", failed: false },
			{
				name: "run_commands",
				failed: true,
				error: "token=[redacted] rejected",
			},
		]);
	});

	test("an edit or a push whose call was denied or failed changes nothing", () => {
		const turn = deriveTurn(
			"s",
			runResult([
				message("user", "Fix the client"),
				message("assistant", [
					{
						type: "tool-call",
						toolCallId: "denied",
						toolName: "editor",
						input: { path: "src/client.ts" },
					},
					{
						type: "tool-call",
						toolCallId: "written",
						toolName: "editor",
						input: { path: "src/retry.ts" },
					},
					{
						type: "tool-call",
						toolCallId: "push",
						toolName: "run_commands",
						input: { command: "git push" },
					},
				]),
				message("tool", [
					{
						type: "tool-result",
						toolCallId: "denied",
						toolName: "editor",
						output: { error: "The user denied this operation." },
						isError: true,
					},
					{
						type: "tool-result",
						toolCallId: "written",
						toolName: "editor",
						output: "ok",
					},
					{
						type: "tool-result",
						toolCallId: "push",
						toolName: "run_commands",
						output: { error: "rejected" },
						isError: true,
					},
				]),
			]),
		);
		expect(turn).toMatchObject({
			facts: { filesEdited: 1, toolErrored: true },
			pushed: false,
		});
		expect(turn?.context.editedPaths).toEqual(["src/retry.ts"]);
	});

	test("an edit whose text was not found and a rejected push, as Cline's own tools report them, change nothing", async () => {
		const editor = createDefaultTools({
			cwd: "/repo",
			executors: {
				editor: async (input) => {
					if (input.path.endsWith("retry.ts"))
						throw new Error("old_text was not found in src/retry.ts");
					return "edited";
				},
				bash: async (command) => {
					const line = String(command);
					if (line.startsWith("npm test"))
						throw new CommandExitError(1, "1 failing");
					if (line.startsWith("git push"))
						throw new CommandExitError(1, "! [rejected] main -> main");
					return "";
				},
			},
		});
		const patch = createDefaultTools({
			cwd: "/repo",
			enableApplyPatch: true,
			executors: {
				applyPatch: async () => {
					throw new Error("context lines did not match src/parser.ts");
				},
			},
		});
		const failedEdits = await new Agent({
			model: callingModel([
				[
					"editor",
					{ path: "/repo/src/retry.ts", old_text: "a", new_text: "b" },
				],
				[
					"editor",
					{ path: "/repo/src/client.ts", old_text: "a", new_text: "b" },
				],
				["run_commands", { commands: ["npm test", "git push"] }],
			]),
			tools: editor,
		}).run("Fix the retry and push");
		const results = failedEdits.messages.flatMap((item) =>
			item.content.filter((part) => part.type === "tool-result"),
		);
		expect(results).toHaveLength(3);
		expect(results.some((part) => part.isError)).toBe(false);
		const turn = deriveTurn("s", failedEdits);
		expect(turn).toMatchObject({
			facts: { filesEdited: 1, toolErrored: false },
			pushed: false,
		});
		expect(turn?.context.editedPaths).toEqual(["/repo/src/client.ts"]);

		const pushedPastFailingTests = await new Agent({
			model: callingModel([
				["run_commands", { commands: ["npm test", "gh pr create --fill"] }],
			]),
			tools: editor,
		}).run("Open the PR");
		expect(deriveTurn("s", pushedPastFailingTests)?.pushed).toBe(true);

		const failedPatch = await new Agent({
			model: callingModel([
				[
					"apply_patch",
					{ input: "*** Begin Patch\n*** Update File: src/parser.ts\n" },
				],
			]),
			tools: patch,
		}).run("Fix the parser");
		expect(deriveTurn("s", failedPatch)?.facts.filesEdited).toBe(0);
	});

	test("a patch core stopped partway through writing counts its files; one it rejected before writing counts none", async () => {
		const cwd = tempDir();
		writeFileSync(
			join(cwd, "blocker"),
			"a file where the patch needs a folder",
		);
		writeFileSync(join(cwd, "client.ts"), "export const retries = 1;\n");
		const tools = createDefaultTools({
			cwd,
			enableApplyPatch: true,
			executors: { applyPatch: createApplyPatchExecutor() },
		});
		const patchRun = (patch: string) =>
			new Agent({
				model: callingModel([["apply_patch", { input: patch }]]),
				tools,
			}).run("Add the retry");

		const partlyWritten = await patchRun(
			[
				"*** Begin Patch",
				"*** Add File: retry.ts",
				"+export const retry = true;",
				"*** Add File: blocker/policy.ts",
				"+export const policy = {};",
				"*** End Patch",
			].join("\n"),
		);
		expect(existsSync(join(cwd, "retry.ts"))).toBe(true);
		expect(toolOutputs(partlyWritten.messages)).toEqual([
			expect.objectContaining({
				success: false,
				error: expect.stringMatching(/^apply_patch failed: E[A-Z]+: /),
			}),
		]);
		expect(deriveTurn("s", partlyWritten)?.context.editedPaths).toEqual([
			"retry.ts",
			"blocker/policy.ts",
		]);

		const movedOutside = await patchRun(
			[
				"*** Begin Patch",
				"*** Add File: backoff.ts",
				"+export const backoff = 2;",
				"*** Update File: client.ts",
				"*** Move to: ../outside/client.ts",
				"@@",
				"-export const retries = 1;",
				"+export const retries = 3;",
				"*** End Patch",
			].join("\n"),
		);
		expect(existsSync(join(cwd, "backoff.ts"))).toBe(true);
		expect(toolOutputs(movedOutside.messages)).toEqual([
			expect.objectContaining({
				success: false,
				error:
					"apply_patch failed: Path must stay within cwd: ../outside/client.ts",
			}),
		]);
		expect(deriveTurn("s", movedOutside)?.context.editedPaths).toEqual([
			"backoff.ts",
			"client.ts",
		]);

		const unapplied = await patchRun(
			[
				"*** Begin Patch",
				"*** Add File: notes.ts",
				"+export const notes = [];",
				"*** Update File: client.ts",
				"@@ export function retry",
				"-\treturn fetchOnce();",
				"+\treturn fetchWithRetry();",
				"*** End Patch",
			].join("\n"),
		);
		expect(existsSync(join(cwd, "notes.ts"))).toBe(false);
		expect(toolOutputs(unapplied.messages)).toEqual([
			expect.objectContaining({ success: false }),
		]);
		expect(deriveTurn("s", unapplied)?.facts.filesEdited).toBe(0);

		const deletesOutside = await patchRun(
			[
				"*** Begin Patch",
				"*** Add File: notes.ts",
				"+export const notes = [];",
				"*** Delete File: ../outside/client.ts",
				"*** End Patch",
			].join("\n"),
		);
		expect(existsSync(join(cwd, "notes.ts"))).toBe(false);
		expect(toolOutputs(deletesOutside.messages)).toEqual([
			expect.objectContaining({
				success: false,
				error:
					"apply_patch failed: Path must stay within cwd: ../outside/client.ts",
			}),
		]);
		expect(deriveTurn("s", deletesOutside)?.facts.filesEdited).toBe(0);
	});

	test("an edit or a patch that ran out of time counts its files, since core lets the write finish", async () => {
		const cwd = tempDir();
		let releaseWrites = () => {};
		const writesHeld = new Promise<void>((resolve) => {
			releaseWrites = resolve;
		});
		const heldWrites: Promise<string>[] = [];
		const held =
			<Args extends unknown[]>(write: (...args: Args) => Promise<string>) =>
			(...args: Args) => {
				const pending = writesHeld.then(() => write(...args));
				heldWrites.push(pending);
				return pending;
			};
		const timedOutEdit = await new Agent({
			model: callingModel([
				["editor", { path: "retry.ts", new_text: "export const retry = 3;\n" }],
			]),
			tools: createDefaultTools({
				cwd,
				editorTimeoutMs: 1,
				executors: { editor: held(createEditorExecutor()) },
			}),
		}).run("Add the retry");
		const timedOutPatch = await new Agent({
			model: callingModel([
				[
					"apply_patch",
					{
						input: [
							"*** Begin Patch",
							"*** Add File: backoff.ts",
							"+export const backoff = 2;",
							"*** End Patch",
						].join("\n"),
					},
				],
			]),
			tools: createDefaultTools({
				cwd,
				enableApplyPatch: true,
				applyPatchTimeoutMs: 1,
				executors: { applyPatch: held(createApplyPatchExecutor()) },
			}),
		}).run("Add the backoff");
		expect(
			toolOutputs([...timedOutEdit.messages, ...timedOutPatch.messages]),
		).toEqual([
			expect.objectContaining({
				success: false,
				error: "Editor operation failed: Editor operation timed out after 1ms",
			}),
			expect.objectContaining({
				success: false,
				error: "apply_patch failed: apply_patch timed out after 1ms",
			}),
		]);

		releaseWrites();
		await Promise.all(heldWrites);
		expect(existsSync(join(cwd, "retry.ts"))).toBe(true);
		expect(existsSync(join(cwd, "backoff.ts"))).toBe(true);
		expect(deriveTurn("s", timedOutEdit)?.context.editedPaths).toEqual([
			"retry.ts",
		]);
		expect(deriveTurn("s", timedOutPatch)?.context.editedPaths).toEqual([
			"backoff.ts",
		]);
	});

	test("an aborted run is a stopped turn, a failed run a failed one; no message is no turn", () => {
		const user = message("user", "Go");
		expect(
			deriveTurn("s", runResult([user], { status: "aborted" }))?.facts.status,
		).toBe("cancelled");
		expect(
			deriveTurn("s", runResult([user], { status: "failed" }))?.facts.status,
		).toBe("failed");
		expect(deriveTurn("s", runResult([]))).toBeNull();
		expect(
			lastPersonMessage([user, message("user", "<hook_context>x")]),
		).toEqual({ id: user.id, text: "Go" });
		expect(editedPaths({ filePath: " x.ts " })).toEqual(["x.ts"]);
	});

	test("a secret across the text limit is redacted whole before the text is cut", () => {
		const secret = "sk-ant-0123456789abcdefghijklmnop";
		const request = `${"x".repeat(TURN_TEXT_LIMIT - 10)} ${secret}`;
		const turn = deriveTurn("s", runResult([message("user", request)]));
		expect(turn?.context.request).not.toContain("sk-ant");
		expect(turn?.context.request).not.toContain("0123");
		expect(turn?.context.request.length).toBeLessThanOrEqual(TURN_TEXT_LIMIT);
	});
});

function toolOutputs(messages: readonly AgentMessage[]): unknown[] {
	return messages.flatMap((item) =>
		item.content.flatMap((part) =>
			part.type === "tool-result" ? [part.output] : [],
		),
	);
}
