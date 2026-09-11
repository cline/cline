/**
 * Differential harness: the v1 inline CLI renderer (reference) vs the
 * v2 frame path (framer → assembler → CliFrameRenderer) must produce
 * byte-identical output for every trace, except the whitelisted P6
 * fix: `done(reason:"error")` now renders as an error instead of v1's
 * fake "finished" banner.
 */
import { generateLegalV1Trace, AgentEventFramer } from "@cline/shared";
import type { AgentEvent } from "@cline/core";
import { StreamAssembler } from "@cline/core";
import { describe, expect, it } from "vitest";
import { V1ReferenceRenderer } from "./agent-renderer-v1.reference";
import { CliFrameRenderer } from "./frame-renderer";

interface Output {
	out: string[];
	err: string[];
}

function makeIo(output: Output) {
	return {
		write: (text: string): void => {
			output.out.push(text);
		},
		writeErr: (text: string): void => {
			output.err.push(text);
		},
	};
}

function renderV1(
	trace: AgentEvent[],
	config: { verbose: boolean },
): Output {
	const output: Output = { out: [], err: [] };
	const renderer = new V1ReferenceRenderer(config, makeIo(output));
	for (const event of trace) {
		renderer.handleEvent(event);
	}
	return output;
}

function renderV2(
	trace: AgentEvent[],
	config: { verbose: boolean },
): Output {
	const output: Output = { out: [], err: [] };
	const renderer = new CliFrameRenderer(config, makeIo(output));
	const framer = new AgentEventFramer();
	const assembler = new StreamAssembler(renderer);
	for (const event of trace) {
		assembler.pushAll(framer.frameEvent(event));
	}
	return output;
}

const hasDoneError = (trace: AgentEvent[]): boolean =>
	trace.some((event) => event.type === "done" && event.reason === "error");

describe("CLI renderer differential — v1 reference vs frame path", () => {
	for (const verbose of [false, true]) {
		it(`generated traces render identically (verbose=${verbose})`, () => {
			for (let seed = 1; seed <= 100; seed += 1) {
				const trace = generateLegalV1Trace(seed, { maxEvents: 60 });
				const v1 = renderV1(trace, { verbose });
				const v2 = renderV2(trace, { verbose });
				if (hasDoneError(trace)) {
					// Whitelisted P6 fix: the run's failure is now an error,
					// not a fake "finished" banner.
					expect(v2.err.length).toBeGreaterThan(v1.err.length);
					continue;
				}
				expect(v1.out, `seed ${seed} stdout`).toEqual(v2.out);
				expect(v1.err, `seed ${seed} stderr`).toEqual(v2.err);
			}
		});
	}

	it("handcrafted edges render identically: ask_question, redacted reasoning, tool error, status notice", () => {
		const trace: AgentEvent[] = [
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "reasoning",
				redacted: true,
			},
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "q1",
				toolName: "ask_question",
				input: { question: "hi" },
			},
			{
				type: "content_end",
				contentType: "tool",
				toolCallId: "q1",
				toolName: "ask_question",
			},
			{
				type: "content_start",
				contentType: "text",
				text: "Answer",
			},
			{
				type: "content_end",
				contentType: "text",
				text: "Answer",
			},
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "t1",
				toolName: "run_command",
				input: { command: "ls" },
			},
			{
				type: "content_end",
				contentType: "tool",
				toolCallId: "t1",
				toolName: "run_command",
				output: "a\nb\nc",
			},
			{
				type: "notice",
				noticeType: "status",
				displayRole: "status",
				reason: "auto_compaction",
				message: "compacting",
			},
			{
				type: "done",
				reason: "completed",
				text: "done",
				iterations: 2,
			},
		];
		const v1 = renderV1(trace, { verbose: true });
		const v2 = renderV2(trace, { verbose: true });
		expect(v1.out).toEqual(v2.out);
		expect(v1.err).toEqual(v2.err);
		// Substrings avoid the ANSI resets between segments.
		expect(v2.out.join("")).toContain("[thinking]");
		expect(v2.out.join("")).toContain("auto-compacting");
		expect(v2.out.join("")).toContain("── finished (2 iterations) ──");
		// ask_question renders nothing in both.
		expect(v2.out.join("")).not.toContain("ask_question");
	});

	it("recoverable errors: identical in both modes", () => {
		const trace: AgentEvent[] = [
			{ type: "iteration_start", iteration: 1 },
			{
				type: "error",
				error: new Error("transient"),
				iteration: 1,
				recoverable: true,
			},
			{
				type: "content_start",
				contentType: "text",
				text: "recovered",
			},
			{
				type: "content_end",
				contentType: "text",
				text: "recovered",
			},
			{
				type: "done",
				reason: "completed",
				text: "ok",
				iterations: 1,
			},
		];
		for (const verbose of [false, true]) {
			const v1 = renderV1(trace, { verbose });
			const v2 = renderV2(trace, { verbose });
			expect(v1.out).toEqual(v2.out);
			expect(v1.err).toEqual(v2.err);
		}
	});
});
