/**
 * Assembler delivery-contract tests: callback order, repair behavior,
 * diagnostics, and the idle edge. The property loop extends Phase 1's
 * generator → framer → validator chain with the assembler: every legal
 * v1 trace must drive the consumer with zero diagnostics and complete
 * scope closure.
 */
import {
	generateLegalV1Trace,
	AgentEventFramer,
	validateFrameStream,
	type StreamFrame,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	DIAG_ORPHAN_BLOCK_FRAME,
	DIAG_STALE_EPOCH,
	DIAG_TURN_CLOSE_WITHOUT_OPEN,
	StreamAssembler,
	type ReasoningSink,
	type SessionConsumer,
	type TextSink,
	type ToolSink,
	type TurnConsumer,
} from "./stream-assembler";

interface RecordedEvent {
	call: string;
	detail?: string;
}

/** Consumer that records every callback in order. */
class RecordingConsumer implements SessionConsumer {
	events: RecordedEvent[] = [];
	idleCount = 0;
	diagnostics: string[] = [];

	private record = (call: string, detail?: string): void => {
		this.events.push({ call, detail });
	};

	onTurn(): TurnConsumer {
		this.record("turn:open");
		return {
			onText: (): TextSink => {
				this.record("text:open");
				return {
					onDelta: (text: string): void => {
						this.record("text:delta", text);
					},
					onAnnotation: (): void => {
						this.record("text:annotation");
					},
					onClose: (outcome: { kind: string }): void => {
						this.record("text:close", outcome.kind);
					},
				};
			},
			onReasoning: (): ReasoningSink => {
				this.record("reasoning:open");
				return {
					onDelta: (reasoning: string): void => {
						this.record("reasoning:delta", reasoning);
					},
					onAnnotation: (): void => {
						this.record("reasoning:annotation");
					},
					onClose: (outcome: { kind: string }): void => {
						this.record("reasoning:close", outcome.kind);
					},
				};
			},
			onTool: (): ToolSink => {
				this.record("tool:open");
				return {
					onProgress: (): void => {
						this.record("tool:progress");
					},
					onAnnotation: (): void => {
						this.record("tool:annotation");
					},
					onClose: (outcome: { kind: string }): void => {
						this.record("tool:close", outcome.kind);
					},
				};
			},
			onMedia: (): void => {
				this.record("media");
			},
			onSubAgent: (): null => null,
			onNotice: (): void => {
				this.record("notice");
			},
			onUsage: (): void => {
				this.record("usage");
			},
			onClose: (outcome: { kind: string }, iterations?: number): void => {
				this.record("turn:close", `${outcome.kind}:${iterations ?? "-"}`);
			},
		};
	}

	onSessionNotice(): void {
		this.record("session:notice");
	}

	onIdle(): void {
		this.idleCount += 1;
	}

	onDiagnostic(diagnostic: { code: string }): void {
		this.diagnostics.push(diagnostic.code);
	}
}

describe("assembler — property loop over legal traces", () => {
	it("delivers every frame with zero diagnostics and reaches idle once per turn", () => {
		for (let seed = 1; seed <= 100; seed += 1) {
			const frames = new AgentEventFramer().frameAll(
				generateLegalV1Trace(seed, { maxEvents: 60 }),
			);
			expect(validateFrameStream(frames).violations, `seed ${seed}`).toEqual(
				[],
			);
			const consumer = new RecordingConsumer();
			const assembler = new StreamAssembler(consumer);
			assembler.pushAll(frames);
			expect(consumer.diagnostics, `seed ${seed} diagnostics`).toEqual([]);
			const turnCloses = consumer.events.filter((event) =>
				event.call.startsWith("turn:close"),
			);
			expect(consumer.idleCount, `seed ${seed}`).toBe(turnCloses.length);
			expect(assembler.openScopes().blocks).toEqual([]);
			expect(assembler.openScopes().turnId).toBeUndefined();
		}
	});

	it("closes every child sink before its turn close (delivery rule 3)", () => {
		for (let seed = 1; seed <= 100; seed += 1) {
			const frames = new AgentEventFramer().frameAll(
				generateLegalV1Trace(seed, { maxEvents: 60 }),
			);
			const consumer = new RecordingConsumer();
			new StreamAssembler(consumer).pushAll(frames);
			let turnClosed = false;
			for (const event of consumer.events) {
				if (event.call === "turn:open") {
					turnClosed = false;
				} else if (event.call.startsWith("turn:close")) {
					turnClosed = true;
				} else if (turnClosed && !event.call.endsWith("annotation")) {
					throw new Error(
						`seed ${seed}: ${event.call} delivered after turn close`,
					);
				}
			}
		}
	});
});

describe("assembler — repairs and diagnostics", () => {
	it("drops stale-epoch frames with a diagnostic", () => {
		const consumer = new RecordingConsumer();
		const assembler = new StreamAssembler(consumer);
		const framer = new AgentEventFramer();
		const run1 = framer.frameAll([
			{ type: "iteration_start", iteration: 1 },
			{ type: "done", reason: "completed", text: "ok", iterations: 1 },
		]);
		assembler.pushAll(run1);
		framer.bumpEpoch();
		assembler.pushAll(
			framer.frameAll([
				{ type: "iteration_start", iteration: 1 },
				{ type: "done", reason: "completed", text: "ok", iterations: 1 },
			]),
		);
		expect(consumer.diagnostics).toEqual([]);
		const opensBefore = consumer.events.filter(
			(event) => event.call === "turn:open",
		).length;
		expect(opensBefore).toBe(2);

		// Replay the epoch-0 frames after the assembler has seen epoch 1:
		// the fenced-conversation straggler scenario. Every frame drops.
		assembler.pushAll(run1);
		expect(consumer.diagnostics).toContain(DIAG_STALE_EPOCH);
		expect(
			consumer.events.filter((event) => event.call === "turn:open").length,
		).toBe(opensBefore);
	});

	it("drops orphan block frames and double turn closes with diagnostics", () => {
		const consumer = new RecordingConsumer();
		const assembler = new StreamAssembler(consumer);
		assembler.pushAll(
			new AgentEventFramer().frameAll([
				{ type: "iteration_start", iteration: 1 },
				{ type: "done", reason: "completed", text: "ok", iterations: 1 },
			]),
		);
		expect(consumer.diagnostics).toEqual([]);

		// A close for a block that never opened, under the closed turn.
		assembler.push({
			v: 2,
			epoch: 0,
			seq: 50,
			scope: { agentPath: ["root"], turnId: "turn-1", blockId: "ghost" },
			kind: "close",
			outcome: { kind: "completed" },
		});
		expect(consumer.diagnostics).toContain(DIAG_ORPHAN_BLOCK_FRAME);

		// A second turn close on the already-closed turn.
		assembler.push({
			v: 2,
			epoch: 0,
			seq: 51,
			scope: { agentPath: ["root"], turnId: "turn-1" },
			kind: "close",
			outcome: { kind: "completed" },
		});
		expect(consumer.diagnostics).toContain(DIAG_TURN_CLOSE_WITHOUT_OPEN);
	});
});
