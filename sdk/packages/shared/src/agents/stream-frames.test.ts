/**
 * Unit tests for the v2 frame tables (`validateFrameStream`). The
 * framer-level loop tests live in agent-event-framer.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
	FRAME_SCHEMA_VERSION,
	SEQ_NOT_INCREASING,
	TURN_CLOSE_WITH_OPEN_CHILDREN,
	TURN_CLOSE_WITHOUT_OPEN,
	TURN_OVERLAP,
	BLOCK_CLOSE_WITHOUT_OPEN,
	validateFrameStream,
	type StreamFrame,
} from "./stream-frames";

const base = { v: FRAME_SCHEMA_VERSION, epoch: 0 } as const;
let seq = 0;
const frame = (body: Record<string, unknown>, scope: Record<string, unknown> = {}): StreamFrame =>
	({
		...base,
		seq: (seq += 1),
		scope: { agentPath: ["root"], ...scope },
		...body,
	}) as StreamFrame;

const openTurn = (): StreamFrame =>
	frame({ kind: "open", openKind: "turn", start: { turnId: "turn-1" } }, { turnId: "turn-1" });
const closeTurn = (turnId = "turn-1"): StreamFrame =>
	frame({ kind: "close", outcome: { kind: "completed" } }, { turnId });

describe("v2 frame tables", () => {
	it("accepts a minimal legal stream", () => {
		const result = validateFrameStream([openTurn(), closeTurn()]);
		expect(result.violations).toEqual([]);
		expect(result.openBlocks).toEqual([]);
	});

	it("flags overlapping turns, double close, and seq regression", () => {
		const overlap = validateFrameStream([openTurn(), openTurn()]);
		expect(overlap.violations[0]?.code).toBe(TURN_OVERLAP);

		const doubleClose = validateFrameStream([
			openTurn(),
			closeTurn(),
			closeTurn(),
		]);
		expect(doubleClose.violations[0]?.code).toBe(TURN_CLOSE_WITHOUT_OPEN);

		seq = 0;
		const regressed = validateFrameStream([
			openTurn(),
			{ ...openTurn(), seq: 1 },
		]);
		expect(
			regressed.violations.some((v) => v.code === SEQ_NOT_INCREASING),
		).toBe(true);
	});

	it("flags a turn close with an open child, and a block close without open", () => {
		const withChild = validateFrameStream([
			openTurn(),
			frame(
				{ kind: "open", openKind: "text", start: { blockId: "b1" } },
				{ turnId: "turn-1", blockId: "b1" },
			),
			closeTurn(),
		]);
		expect(withChild.violations[0]?.code).toBe(
			TURN_CLOSE_WITH_OPEN_CHILDREN,
		);
		expect(withChild.openBlocks).toEqual(["b1"]);

		const orphanClose = validateFrameStream([
			openTurn(),
			frame({ kind: "close", outcome: { kind: "completed" } }, {
				turnId: "turn-1",
				blockId: "ghost",
			}),
		]);
		expect(orphanClose.violations[0]?.code).toBe(BLOCK_CLOSE_WITHOUT_OPEN);
	});
});
