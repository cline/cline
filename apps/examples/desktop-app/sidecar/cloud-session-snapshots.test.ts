import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { reconcileBufferedCloudEvents } from "./cloud-session-snapshots";

describe("reconcileBufferedCloudEvents", () => {
	const event = (
		name: HubEventEnvelope["event"],
		id: string,
		payload: Record<string, unknown> = {},
	): HubEventEnvelope => ({
		version: "v1",
		event: name,
		eventId: id,
		timestamp: Date.now(),
		sessionId: "inner-1",
		payload,
	});

	it.each([
		"Continue",
		"",
	])("preserves submitted lifecycle while marking only newly reflected %j prompts", (prompt) => {
		const submitted = (id: string) =>
			event("session.pending_prompt_submitted", id, {
				prompt: {
					id,
					prompt,
					delivery: "queue",
					...(prompt
						? {}
						: {
								userImages: ["data:image/png;base64,AA=="],
								attachmentCount: 1,
							}),
				},
			});
		const first = submitted("q-1");
		const later = submitted("q-2");
		const baseline = [
			{
				role: "user",
				content: prompt || [
					{
						type: "image",
						source: { type: "base64", media_type: "image/png", data: "AA==" },
					},
				],
			},
		];
		// An older identical user message must not consume a new submission.
		expect(
			reconcileBufferedCloudEvents([first], baseline, {
				baselineMessages: baseline,
			}),
		).toEqual([first]);
		const snapshot = [
			...baseline,
			{
				...baseline[0],
				...(prompt ? { content: `<user_input>${prompt}</user_input>` } : {}),
			},
		];
		const completed = event("run.completed", "done");
		const running = event("run.started", "next");
		// Keep the next turn's start between lifecycle events; only its bubble is reflected.
		expect(
			reconcileBufferedCloudEvents(
				[completed, first, running, later],
				snapshot,
				{
					baselineMessages: baseline,
				},
			),
		).toEqual([
			completed,
			{ ...first, payload: { ...first.payload, transcriptReflected: true } },
			running,
			later,
		]);
		// A submission received after the transcript reply cannot be in it.
		expect(
			reconcileBufferedCloudEvents([later], snapshot, {
				baselineMessages: baseline,
				messagesSnapshotEventCutoff: 0,
			}),
		).toEqual([later]);
	});

	it("replays content the snapshot does NOT contain", () => {
		const buffered = [
			event("assistant.delta", "a-1", { text: "unpersisted reply" }),
			event("run.completed", "done-1"),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "a completely different answer" },
			]).map((item) => item.event),
		).toEqual(["assistant.delta", "run.completed"]);
	});

	it("does not let an interior substring claim another run's snapshot", () => {
		const buffered = [
			event("assistant.finished", "a-1", { text: "foo" }),
			event("run.completed", "done-1"),
			event("assistant.finished", "a-2", { text: "The answer is foobar" }),
			event("run.completed", "done-2"),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "The answer is foobar" },
			]).map((item) => item.eventId),
		).toEqual(["a-1", "done-1", "done-2"]);
	});

	it.each([
		["bar", "foobar", false],
		["bar", "foobar", true],
		["Done", "Done", false],
	] as const)("preserves aborted %j beside saved %j (reverse: %s)", (partial, saved, reverse) => {
		const aborted = [
			event("assistant.delta", "partial", { text: partial }),
			event("run.aborted", "aborted"),
		];
		const completed = [
			event("assistant.delta", "saved-delta", { text: saved }),
			event("assistant.finished", "saved-finished", { text: saved }),
			event("run.completed", "completed"),
		];
		expect(
			reconcileBufferedCloudEvents(
				reverse ? [...completed, ...aborted] : [...aborted, ...completed],
				[{ role: "assistant", content: saved }],
			).map((item) => item.eventId),
		).toEqual(
			reverse
				? ["completed", "partial", "aborted"]
				: ["partial", "aborted", "completed"],
		);
	});

	it.each([
		"assistant",
		"reasoning",
	] as const)("does not let finished %s hide the other aborted content", (finished) => {
		const partial = finished === "assistant" ? "reasoning" : "assistant";
		const buffered = [
			event(`${finished}.finished`, "saved", {
				text: "foobar",
				reasoning: "foobar",
			}),
			event(`${partial}.delta`, "partial", { text: "bar" }),
			event("run.aborted", "aborted"),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "foobar" },
						{ type: "thinking", thinking: "foobar" },
					],
				},
			]).map((item) => item.eventId),
		).toEqual(["partial", "aborted"]);
	});

	it.each([
		["assistant", false],
		["reasoning", false],
		["reasoning", true],
	] as const)("preserves unfinished %s after saved output (redacted: %s)", (kind, redacted) => {
		const saved = [
			event(`${kind}.delta`, "saved-delta", {
				text: redacted ? "" : "saved",
				redacted,
			}),
			event(`${kind}.finished`, "saved-finished", {
				[kind === "assistant" ? "text" : "reasoning"]: redacted
					? undefined
					: "saved",
			}),
		];
		const partial = event(`${kind}.delta`, "partial", { text: "unfinished" });
		const snapshot = [
			{
				role: "assistant",
				content: [
					redacted
						? { type: "redacted_thinking", data: "opaque" }
						: kind === "assistant"
							? { type: "text", text: "saved" }
							: { type: "thinking", thinking: "saved" },
				],
			},
		];
		for (const terminal of ["run.aborted", "run.failed"] as const) {
			const end = event(terminal, "end");
			const buffered = [...saved, partial, end];
			expect(reconcileBufferedCloudEvents(buffered, snapshot)).toEqual([
				partial,
				end,
			]);
			const earlier = [
				{
					role: "assistant",
					content: [
						kind === "assistant"
							? { type: "text", text: "earlier" }
							: { type: "thinking", thinking: "earlier" },
					],
				},
			];
			expect(
				reconcileBufferedCloudEvents(
					[
						event(`${kind}.finished`, "earlier", {
							[kind === "assistant" ? "text" : "reasoning"]: "earlier",
						}),
						...buffered,
					],
					[...earlier, ...snapshot],
					{ baselineMessages: earlier },
				),
			).toEqual([partial, end]);
			expect(reconcileBufferedCloudEvents(buffered, [])).toEqual(buffered);
			expect(
				reconcileBufferedCloudEvents(buffered, snapshot, {
					baselineMessages: snapshot,
				}),
			).toEqual(buffered);
			expect(
				reconcileBufferedCloudEvents(buffered, snapshot, {
					messagesSnapshotEventCutoff: 1,
				}),
			).toEqual(
				terminal === "run.aborted" ? buffered : [saved[1], partial, end],
			);
		}
	});

	it.each([
		"run.completed",
		"run.aborted",
		"run.failed",
	] as const)("ignores empty finishes after saved content in %s", (terminal) => {
		const end = event(terminal, "end");
		expect(
			reconcileBufferedCloudEvents(
				[
					event("assistant.finished", "saved", { text: "saved" }),
					event("assistant.finished", "empty", { text: "" }),
					event("assistant.finished", "missing"),
					end,
				],
				[{ role: "assistant", content: "saved" }],
			),
		).toEqual([end]);
	});

	it("supersedes despite trailing whitespace in the streamed text", () => {
		const buffered = [
			event("assistant.finished", "f-1", { text: "the answer \n" }),
			event("run.completed", "done-1"),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "prefix the answer" },
			]).map((item) => item.event),
		).toEqual(["run.completed"]);
	});

	it("drops buffered queue snapshots when a fresh queue snapshot was applied", () => {
		const buffered = [
			event("session.pending_prompts", "q-1", { prompts: [] }),
			event("assistant.delta", "a-1", { text: "live tail" }),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, []).map((item) => item.event),
		).toEqual(["assistant.delta"]);
	});

	it("replays the newest buffered queue snapshot when the queue fetch failed", () => {
		const buffered = [
			event("session.pending_prompts", "q-1", { prompts: [] }),
			event("session.pending_prompts", "q-2", {
				prompts: [{ id: "p-1", prompt: "queued work" }],
			}),
			event("assistant.delta", "a-1", { text: "live tail" }),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [], {
				queueSnapshotApplied: false,
			}).map((item) => item.eventId),
		).toEqual(["q-2", "a-1"]);
	});

	it("replays a queue snapshot received after the queue fetch", () => {
		const buffered = [
			event("session.pending_prompts", "q-old", { prompts: [] }),
			event("assistant.delta", "a-1", { text: "live tail" }),
			event("session.pending_prompts", "q-new", {
				prompts: [{ id: "p-1", prompt: "queued work" }],
			}),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [], {
				queueSnapshotEventCutoff: 1,
			}).map((item) => item.eventId),
		).toEqual(["a-1", "q-new"]);
	});

	it("supersedes content independently across two terminal run segments", () => {
		const buffered = [
			event("assistant.delta", "a-1", { text: "first tail" }),
			event("run.completed", "done-1"),
			event("assistant.delta", "a-2", { text: "second tail" }),
			event("run.completed", "done-2"),
		];

		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "prefix first tail" },
				{ role: "assistant", content: "prefix second tail" },
			]).map((item) => item.event),
		).toEqual(["run.completed", "run.completed"]);
	});

	it("does not let an older identical reply supersede a new buffered turn", () => {
		const buffered = [
			event("assistant.delta", "a-2", { text: "Done" }),
			event("run.completed", "done-2"),
		];
		const baseline = [{ role: "assistant", content: "Done" }];

		expect(
			reconcileBufferedCloudEvents(buffered, baseline, {
				baselineMessages: baseline,
			}).map((item) => item.event),
		).toEqual(["assistant.delta", "run.completed"]);
		expect(
			reconcileBufferedCloudEvents(
				buffered,
				[...baseline, { role: "assistant", content: "Done" }],
				{ baselineMessages: baseline },
			).map((item) => item.event),
		).toEqual(["run.completed"]);
	});

	it("keeps run.failed while suppressing reflected content and dedupes tools by id", () => {
		const buffered = [
			event("assistant.delta", "a-1", { text: "partial failure" }),
			event("tool.started", "tool-1", { toolCallId: "call-1" }),
			event("run.failed", "failed-1", { error: "boom" }),
		];

		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "saved partial failure" },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call-1", name: "read_file" }],
				},
			]).map((item) => item.event),
		).toEqual(["run.failed"]);
	});

	it("only suppresses tool phases present in the transcript before its cutoff", () => {
		const started = event("tool.started", "start", { toolCallId: "call-1" });
		const finished = event("tool.finished", "finish", {
			toolCallId: "call-1",
			output: "done",
		});
		const snapshot = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "call-1", name: "read_file" }],
			},
		];
		expect(reconcileBufferedCloudEvents([started, finished], snapshot)).toEqual(
			[finished],
		);
		const completedSnapshot = [
			...snapshot,
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "call-1", content: "done" },
				],
			},
		];
		expect(
			reconcileBufferedCloudEvents([started, finished], completedSnapshot),
		).toEqual([]);
		expect(
			reconcileBufferedCloudEvents([started, finished], completedSnapshot, {
				messagesSnapshotEventCutoff: 1,
			}),
		).toEqual([finished]);
	});

	it.each([
		["run.failed", false],
		["run.aborted", false],
		["run.aborted", true],
	] as const)("does not replay persisted thinking for %s (redacted: %s)", (terminal, redacted) => {
		const buffered = [
			event("reasoning.delta", "thinking", {
				text: redacted ? "" : "Checking",
				redacted,
			}),
			event("reasoning.finished", "thought", {
				reasoning: redacted ? undefined : "Checking",
			}),
			event(terminal, "end"),
		];
		const snapshot = [
			{
				role: "assistant",
				content: [
					redacted
						? { type: "redacted_thinking", data: "opaque" }
						: { type: "thinking", thinking: "Checking" },
				],
			},
		];
		expect(reconcileBufferedCloudEvents(buffered, snapshot)).toEqual([
			buffered[2],
		]);
		expect(reconcileBufferedCloudEvents(buffered, [])).toEqual(buffered);
		expect(
			reconcileBufferedCloudEvents(buffered, snapshot, {
				baselineMessages: snapshot,
			}),
		).toEqual(buffered);
		expect(
			reconcileBufferedCloudEvents(buffered, snapshot, {
				messagesSnapshotEventCutoff: 0,
			}),
		).toEqual(buffered);
	});

	it("does not treat persisted assistant text as proof that thinking was saved", () => {
		const thinking = event("reasoning.delta", "thinking", { text: "Checking" });
		const done = event("run.completed", "done");
		expect(
			reconcileBufferedCloudEvents(
				[
					thinking,
					event("assistant.finished", "answer", { text: "Done" }),
					done,
				],
				[{ role: "assistant", content: "Done" }],
			),
		).toEqual([thinking, done]);
	});
});
