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
	SessionFramer,
	validateFrameStream,
	type StreamFrame,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	DIAG_ORPHAN_BLOCK_FRAME,
	DIAG_STALE_EPOCH,
	DIAG_SUBAGENT_WITHOUT_TURN,
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
			expect(assembler.openScopes().turnPaths).toEqual([]);
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

describe("assembler — sub-agent routing (Phase 3a)", () => {
	/** Consumer with per-path event logs and a prunable sub-agent. */
	class SubAgentConsumer implements SessionConsumer {
		events: string[] = [];
		idleCount = 0;
		diagnostics: string[] = [];
		pruneChildren = false;
		subAgentConsumed = false;

		onTurn(): TurnConsumer {
			this.events.push("turn:open");
			return this.makeConsumer("root");
		}

		private makeConsumer(path: string): TurnConsumer {
			const self = this;
			return {
				onText: (): TextSink => {
					self.events.push(`${path}:text:open`);
					return {
						onDelta: (text: string): void => {
							self.events.push(`${path}:text:delta`);
							void text;
						},
						onAnnotation: (): void => {},
						onClose: (): void => {
							self.events.push(`${path}:text:close`);
						},
					};
				},
				onReasoning: (): ReasoningSink => {
					return {
						onDelta: (): void => {},
						onAnnotation: (): void => {},
						onClose: (): void => {},
					};
				},
				onTool: (): ToolSink => {
					self.events.push(`${path}:tool:open`);
					return {
						onProgress: (): void => {},
						onAnnotation: (): void => {},
						onClose: (outcome: { kind: string }): void => {
							self.events.push(`${path}:tool:close:${outcome.kind}`);
						},
					};
				},
				onMedia: (): void => {},
				onSubAgent: (): TurnConsumer | null => {
					if (self.pruneChildren) {
						return null;
					}
					self.subAgentConsumed = true;
					return self.makeConsumer("child");
				},
				onNotice: (): void => {},
				onUsage: (): void => {},
				onClose: (outcome: { kind: string }): void => {
					self.events.push(`${path}:turn:close:${outcome.kind}`);
				},
			};
		}

		onSessionNotice(): void {}
		onIdle(): void {
			this.idleCount += 1;
		}
		onDiagnostic(diagnostic: { code: string }): void {
			this.diagnostics.push(diagnostic.code);
		}
	}

	const push = (
		assembler: StreamAssembler,
		frames: readonly StreamFrame[],
	): void => {
		assembler.pushAll(frames);
	};

	it("routes child frames to onSubAgent's consumer; pruning drops them silently", () => {
		// Routed: the child stream renders via its own consumer.
		const consumer = new SubAgentConsumer();
		const assembler = new StreamAssembler(consumer);
		const framer = new SessionFramer();
		push(assembler, framer.frameEvent({ type: "iteration_start", iteration: 1 }));
		push(
			assembler,
			framer.frameRoutedEvent(["root", "agent-a"], {
				type: "content_start",
				contentType: "text",
				text: "child text",
			}),
		);
		expect(consumer.subAgentConsumed).toBe(true);
		expect(consumer.events).toContain("child:text:delta");
		expect(consumer.diagnostics).toEqual([]);

		// Pruned: same input, consumer says null — nothing reaches it and
		// nothing is diagnosed (P5: pruning is deliberate, not a fault).
		const pruner = new SubAgentConsumer();
		pruner.pruneChildren = true;
		const prunerAssembler = new StreamAssembler(pruner);
		const framer2 = new SessionFramer();
		push(
			prunerAssembler,
			framer2.frameEvent({ type: "iteration_start", iteration: 1 }),
		);
		push(
			prunerAssembler,
			framer2.frameRoutedEvent(["root", "agent-a"], {
				type: "content_start",
				contentType: "text",
				text: "child text",
			}),
		);
		expect(pruner.subAgentConsumed).toBe(false);
		expect(pruner.diagnostics).toEqual([]);
		expect(pruner.events).not.toContain("child:text:delta");
	});

	it("closing the parent turn force-closes the child stream first (rule 3)", () => {
		const consumer = new SubAgentConsumer();
		const assembler = new StreamAssembler(consumer);
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
		];
		assembler.pushAll(frames);
		// Parent completes while the child is mid-flight.
		assembler.pushAll(
			framer.frameEvent({
				type: "done",
				reason: "completed",
				text: "ok",
				iterations: 1,
			}),
		);
		expect(consumer.diagnostics).toEqual([]);
		const childClose = consumer.events.indexOf("child:turn:close:interrupted");
		const parentClose = consumer.events.indexOf("root:turn:close:completed");
		expect(childClose).toBeGreaterThanOrEqual(0);
		expect(parentClose).toBeGreaterThan(childClose);
		// The child's open text block closed before its turn.
		const childTextClose = consumer.events.indexOf("child:text:close");
		expect(childTextClose).toBeGreaterThan(-1);
		expect(childTextClose).toBeLessThan(childClose);
	});

	it("child frames with no parent turn open are diagnosed, not guessed", () => {
		const consumer = new SubAgentConsumer();
		const assembler = new StreamAssembler(consumer);
		const framer = new SessionFramer();
		assembler.pushAll(
			framer.frameRoutedEvent(["root", "agent-a"], {
				type: "content_start",
				contentType: "text",
				text: "orphan child",
			}),
		);
		expect(consumer.diagnostics).toContain(DIAG_SUBAGENT_WITHOUT_TURN);
		expect(consumer.subAgentConsumed).toBe(false);
	});
});
