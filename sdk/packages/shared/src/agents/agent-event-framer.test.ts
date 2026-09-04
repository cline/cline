/**
 * Phase 1 tests: framer wart-fixes, and the closed property loop —
 * generateLegalV1Trace → AgentEventFramer → validateFrameStream must
 * be zero-violation for every seed.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./types";
import { validateAgentEventStream } from "./stream-grammar";
import { AgentEventFramer, SessionFramer } from "./agent-event-framer";
import { validateFrameStream, type StreamFrame } from "./stream-frames";
import { generateLegalV1Trace } from "./v1-trace-generator";

// ---------------------------------------------------------------------------
// v1 fixtures (same shapes as stream-grammar.test.ts)
// ---------------------------------------------------------------------------

const iterStart = (iteration = 1): AgentEvent => ({
	type: "iteration_start",
	iteration,
});
const textStart = (text: string): AgentEvent => ({
	type: "content_start",
	contentType: "text",
	text,
});
const textEnd = (text: string): AgentEvent => ({
	type: "content_end",
	contentType: "text",
	text,
});
const toolOpen = (toolCallId: string, input: unknown): AgentEvent => ({
	type: "content_start",
	contentType: "tool",
	toolCallId,
	toolName: "read_file",
	input,
});
const toolUpdate = (toolCallId: string): AgentEvent => ({
	type: "content_update",
	contentType: "tool",
	toolCallId,
	update: { p: 1 },
});
const toolClose = (toolCallId: string, error?: string): AgentEvent => ({
	type: "content_end",
	contentType: "tool",
	toolCallId,
	toolName: "read_file",
	output: "ok",
	...(error !== undefined ? { error } : {}),
});
const done = (reason = "completed"): AgentEvent => ({
	type: "done",
	reason,
	text: "ok",
	iterations: 1,
});
const errorEvent = (recoverable: boolean): AgentEvent => ({
	type: "error",
	error: new Error("boom"),
	iteration: 1,
	recoverable,
});

const kindsOf = (frames: StreamFrame[]): string[] =>
	frames.map((frame) =>
		frame.kind === "open" ? `open:${frame.openKind}` : frame.kind,
	);

describe("annotations — non-agent producers addressing tool blocks", () => {
	const approved = {
		kind: "annotation",
		ns: "approval",
		body: { state: "approved", messageTs: 42 },
	} as const;

	it("a pre-open annotation is addressed to the open turn, shares the seq counter, and validates", () => {
		const framer = new AgentEventFramer();
		const frames = [
			...framer.frameAll([iterStart(1)]),
			...framer.annotateBlock("call_1", approved),
			...framer.frameAll([toolOpen("call_1", {}), toolClose("call_1"), done()]),
		];
		expect(kindsOf(frames)).toEqual([
			"open:turn",
			"notice",
			"annotation",
			"open:tool",
			"close",
			"close",
		]);
		const annotation = frames[2];
		expect(annotation.scope).toEqual({
			agentPath: ["root"],
			turnId: "turn-1",
			blockId: "call_1",
		});
		for (let i = 1; i < frames.length; i += 1) {
			expect(frames[i].seq).toBe(frames[i - 1].seq + 1);
		}
		expect(validateFrameStream(frames).violations).toEqual([]);
	});

	it("annotating with no open turn lazily opens one, like every turn-scoped event", () => {
		const framer = new AgentEventFramer();
		const frames = framer.annotateBlock("call_1", approved);
		expect(kindsOf(frames)).toEqual(["open:turn", "annotation"]);
		expect(frames[1].scope.turnId).toBe("turn-1");
	});

	it("SessionFramer routes the annotation to the agent path's stream", () => {
		const framer = new SessionFramer();
		const frames = [
			...framer.frameRoutedEvent(["root", "agent-a"], iterStart(1)),
			...framer.annotateBlock(["root", "agent-a"], "call_1", approved),
		];
		expect(frames[2].scope).toEqual({
			agentPath: ["root", "agent-a"],
			turnId: "turn-1",
			blockId: "call_1",
		});
	});

	it("an annotation on a turn the stream never opened is a violation", () => {
		const frames = new AgentEventFramer().frameAll([iterStart(1), done()]);
		const stray: StreamFrame = {
			v: 2,
			epoch: 0,
			seq: frames[frames.length - 1].seq + 1,
			scope: { agentPath: ["root"], turnId: "turn-9", blockId: "call_1" },
			...approved,
		};
		const validation = validateFrameStream([...frames, stray]);
		expect(validation.violations.map((violation) => violation.code)).toEqual([
			"annotation-unknown-scope",
		]);
	});
});

describe("SessionFramer — multiplexed agent paths", () => {
	it("interleaved root and child streams share one strictly-increasing seq and validate cleanly", () => {
		const framer = new SessionFramer();
		const rootTrace = generateLegalV1Trace(11, { maxEvents: 30 });
		const childTrace = generateLegalV1Trace(12, { maxEvents: 30 });
		const frames = [];
		// Round-robin interleave: path-independence is the point.
		for (let i = 0; i < Math.max(rootTrace.length, childTrace.length); i += 1) {
			if (rootTrace[i] !== undefined) {
				frames.push(...framer.frameEvent(rootTrace[i]));
			}
			if (childTrace[i] !== undefined) {
				frames.push(
					...framer.frameRoutedEvent(["root", "agent-a"], childTrace[i]),
				);
			}
		}
		for (let i = 1; i < frames.length; i += 1) {
			expect(frames[i].seq).toBe(frames[i - 1].seq + 1);
		}
		const validation = validateFrameStream(frames);
		expect(validation.violations).toEqual([]);
		expect(validation.openBlocks).toEqual([]);
		expect(validation.openTurns).toEqual([]);
	});

	it("frameEvent on the root path matches a standalone AgentEventFramer", () => {
		const trace = generateLegalV1Trace(13, { maxEvents: 20 });
		const sessionFramer = new SessionFramer();
		const standalone = new AgentEventFramer();
		expect(sessionFramer.frameAll(trace)).toEqual(standalone.frameAll(trace));
	});

	it("a parent turn close emits descendant closes first (scope tree rule 3, producer-side)", () => {
		const framer = new SessionFramer();
		const frames = [
			...framer.frameEvent({ type: "iteration_start", iteration: 1 }),
			...framer.frameRoutedEvent(["root", "agent-a"], {
				type: "iteration_start",
				iteration: 1,
			}),
			...framer.frameRoutedEvent(["root", "agent-a"], {
				type: "content_start",
				contentType: "text",
				text: "working",
			}),
			// Parent completes while the child is mid-flight.
			...framer.frameEvent({
				type: "done",
				reason: "completed",
				text: "ok",
				iterations: 1,
			}),
		];
		const validation = validateFrameStream(frames);
		expect(validation.violations).toEqual([]);
		// The producer closed the child — nothing dangles for the
		// assembler to repair.
		expect(validation.openTurns).toEqual([]);
		expect(validation.openBlocks).toEqual([]);
		// Child closes precede the parent turn close.
		const closes = frames
			.map((frame, index) => ({ frame, index }))
			.filter(({ frame }) => frame.kind === "close");
		const parentTurnClose = closes.find(
			({ frame }) =>
				frame.kind === "close" &&
				frame.scope.agentPath.join("/") === "root" &&
				frame.scope.blockId === undefined,
		);
		const childCloses = closes.filter(
			({ frame }) =>
				frame.kind === "close" &&
				frame.scope.agentPath.join("/") === "root/agent-a",
		);
		expect(childCloses.length).toBeGreaterThan(0);
		for (const child of childCloses) {
			expect(child.index).toBeLessThan(parentTurnClose?.index ?? -1);
		}
	});

	it("fence closes every path and bumpEpoch applies to all paths", () => {
		const framer = new SessionFramer();
		const allFrames = [];
		allFrames.push(
			...framer.frameEvent({ type: "iteration_start", iteration: 1 }),
		);
		allFrames.push(
			...framer.frameRoutedEvent(["root", "agent-a"], {
				type: "iteration_start",
				iteration: 1,
			}),
		);
		const fenced = framer.fence();
		// Two turns closed: root and agent-a.
		expect(fenced.filter((frame) => frame.kind === "close")).toHaveLength(2);
		const validation = validateFrameStream([...allFrames, ...fenced]);
		expect(validation.violations).toEqual([]);
		expect(validation.openTurns).toEqual([]);

		framer.bumpEpoch();
		const next = framer.frameEvent({ type: "iteration_start", iteration: 1 });
		expect(next.every((frame) => frame.epoch === 1)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Property loop: v1 tables → framer → v2 tables
// ---------------------------------------------------------------------------

describe("closed loop: legal v1 trace → frames → zero violations", () => {
	it("holds for 200 deterministic seeds", () => {
		for (let seed = 1; seed <= 200; seed += 1) {
			const trace = generateLegalV1Trace(seed, { maxEvents: 60 });
			const v1 = validateAgentEventStream(trace);
			expect(v1.violations).toEqual([]);

			const framer = new AgentEventFramer();
			const frames = framer.frameAll(trace);
			const v2 = validateFrameStream(frames);
			expect(
				v2.violations,
				`seed ${seed} framed with violations`,
			).toEqual([]);
			expect(v2.openBlocks).toEqual([]);
			expect(v2.openTurns).toEqual([]);
		}
	});

	it("seq increases by exactly one per frame across the stream", () => {
		for (let seed = 1; seed <= 50; seed += 1) {
			const frames = new AgentEventFramer().frameAll(
				generateLegalV1Trace(seed, { maxEvents: 60 }),
			);
			for (let i = 1; i < frames.length; i += 1) {
				expect(frames[i].seq).toBe(frames[i - 1].seq + 1);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Framer wart-fixes
// ---------------------------------------------------------------------------

describe("framer wart-fixes", () => {
	it("W1: text deltas frame as one open plus deltas, then a close with the final", () => {
		const frames = new AgentEventFramer().frameAll([
			iterStart(1),
			textStart("He"),
			textStart("llo"),
			textEnd("Hello"),
			done(),
		]);
		expect(kindsOf(frames)).toEqual([
			"open:turn",
			"notice",
			"open:text",
			"delta",
			"delta",
			"close",
			"close",
		]);
		const close = frames[5];
		if (close.kind !== "close") {
			throw new Error("expected close");
		}
		expect(close.final).toEqual({ type: "text", text: "Hello" });
	});

	it("W2: a final with no deltas frames as open+close, never close-without-open", () => {
		const frames = new AgentEventFramer().frameAll([
			iterStart(1),
			textEnd("done"),
			done(),
		]);
		expect(validateFrameStream(frames).violations).toEqual([]);
		expect(kindsOf(frames)).toEqual([
			"open:turn",
			"notice",
			"open:text",
			"close",
			"close",
		]);
	});

	it("W3 + P3: terminal mid-tool force-closes with interrupted, and close carries the open's input", () => {
		const frames = new AgentEventFramer().frameAll([
			iterStart(1),
			toolOpen("call_1", { path: "/tmp/x" }),
			errorEvent(false),
		]);
		const toolClose = frames.find(
			(frame) => frame.kind === "close" && frame.scope.blockId === "call_1",
		);
		if (toolClose === undefined || toolClose.kind !== "close") {
			throw new Error("expected tool close");
		}
		expect(toolClose.outcome).toEqual({ kind: "interrupted" });
		expect(toolClose.final).toEqual({
			type: "tool",
			input: { path: "/tmp/x" },
		});
		const turnClose = frames[frames.length - 1];
		if (turnClose.kind !== "close") {
			throw new Error("expected turn close");
		}
		expect(turnClose.outcome).toMatchObject({ kind: "error" });
		expect(validateFrameStream(frames).violations).toEqual([]);
	});

	it("W4: a recoverable error is a notice and the turn closes exactly once", () => {
		const frames = new AgentEventFramer().frameAll([
			iterStart(1),
			errorEvent(true),
			textStart("still going"),
			textEnd("recovered"),
			done(),
		]);
		const closes = frames.filter(
			(frame) => frame.kind === "close" && frame.scope.blockId === undefined,
		);
		expect(closes).toHaveLength(1);
		expect(
			frames.some(
				(frame) => frame.kind === "notice" && frame.noticeType === "recovery",
			),
		).toBe(true);
	});

	it("P6: done(reason:'error') without an error event frames as the error outcome", () => {
		const frames = new AgentEventFramer().frameAll([
			iterStart(1),
			textEnd("partial"),
			done("error"),
		]);
		const turnClose = frames[frames.length - 1];
		if (turnClose.kind !== "close") {
			throw new Error("expected turn close");
		}
		expect(turnClose.outcome).toEqual({
			kind: "error",
			error: { code: "run_failed", message: "ok" },
			via: "done",
		});
	});

	it("aborted maps to interrupted; max_iterations maps to completed", () => {
		const aborted = new AgentEventFramer().frameAll([
			iterStart(1),
			done("aborted"),
		]);
		let close = aborted[aborted.length - 1];
		if (close.kind !== "close") {
			throw new Error("expected close");
		}
		expect(close.outcome).toEqual({ kind: "interrupted" });

		const capped = new AgentEventFramer().frameAll([
			iterStart(1),
			done("max_iterations"),
		]);
		close = capped[capped.length - 1];
		if (close.kind !== "close") {
			throw new Error("expected close");
		}
		expect(close.outcome).toEqual({ kind: "completed", finishReason: "max_iterations" });
	});

	it("epoch changes only via bumpEpoch; seq continues across turns", () => {
		const framer = new AgentEventFramer();
		const first = framer.frameAll([iterStart(1), done()]);
		framer.bumpEpoch();
		const second = framer.frameAll([iterStart(1), done()]);
		expect(first.every((frame) => frame.epoch === 0)).toBe(true);
		expect(second.every((frame) => frame.epoch === 1)).toBe(true);
		expect(second[0].seq).toBe(first[first.length - 1].seq + 1);
		expect(second[0].kind).toBe("open");
	});

	it("a tool error frames the error outcome on the block close", () => {
		const frames = new AgentEventFramer().frameAll([
			iterStart(1),
			toolOpen("call_1", {}),
			toolUpdate("call_1"),
			toolClose("call_1", "boom"),
			done(),
		]);
		const toolCloseFrame = frames.find(
			(frame) => frame.kind === "close" && frame.scope.blockId === "call_1",
		);
		if (toolCloseFrame === undefined || toolCloseFrame.kind !== "close") {
			throw new Error("expected tool close");
		}
		expect(toolCloseFrame.outcome).toEqual({
			kind: "error",
			error: { code: "tool_error", message: "boom" },
		});
	});
});
