import { describe, expect, it } from "vitest";
import { z } from "zod";
import { hubObject } from "./define";
import {
	findBreakingHubProtocolChanges,
	toHubProtocolDocument,
} from "./json-schema";

function document(input: z.ZodType, output?: z.ZodType, event?: z.ZodType) {
	return toHubProtocolDocument({
		protocolVersion: "v1",
		envelopes: {},
		commands: { "demo.run": { description: "demo", input, output } },
		events: event
			? { "demo.done": { description: "demo", payload: event } }
			: {},
	});
}

describe("findBreakingHubProtocolChanges", () => {
	const base = hubObject({ id: z.string(), limit: z.number().optional() });

	it("allows additive changes", () => {
		expect(
			findBreakingHubProtocolChanges(
				document(base, hubObject({ ok: z.boolean() })),
				document(
					base.extend({ note: z.string().optional() }),
					hubObject({ ok: z.boolean(), extra: z.string().optional() }),
				),
			),
		).toEqual([]);
	});

	it("flags inputs that stop accepting what old clients send", () => {
		expect(
			findBreakingHubProtocolChanges(
				document(base),
				document(hubObject({ id: z.number(), mode: z.string() })),
			),
		).toEqual([
			"command demo.run input.id: type changed from string to number",
			"command demo.run input.limit: removed (senders still pass it)",
			"command demo.run input.mode: newly required",
		]);
	});

	it("flags outputs and events that stop providing what old clients read", () => {
		const before = document(
			base,
			hubObject({ ok: z.boolean(), task: z.string() }),
			hubObject({ status: z.enum(["done", "failed"]) }),
		);
		const after = document(
			base,
			hubObject({ ok: z.boolean().optional() }),
			hubObject({ status: z.enum(["done", "failed", "partial"]) }),
		);
		expect(findBreakingHubProtocolChanges(before, after)).toEqual([
			"command demo.run output.ok: no longer always present",
			"command demo.run output.task: removed (readers still expect it)",
			'event demo.done.status: may now produce "partial"',
		]);
	});

	it("looks inside nullable unions instead of comparing them whole", () => {
		const options = (extra: z.ZodRawShape) =>
			hubObject({
				options: hubObject({ depth: z.number(), ...extra }).nullish(),
			});
		expect(
			findBreakingHubProtocolChanges(
				document(options({})),
				document(options({ note: z.string().optional() })),
			),
		).toEqual([]);
		expect(
			findBreakingHubProtocolChanges(
				document(options({})),
				document(options({ note: z.string() })),
			),
		).toEqual(["command demo.run input.options.note: newly required"]);
		expect(
			findBreakingHubProtocolChanges(
				document(hubObject({ id: z.string().nullish() })),
				document(hubObject({ id: z.string().optional() })),
			),
		).toEqual(["command demo.run input.id: no longer accepts null"]);
	});

	it("flags removed commands and events", () => {
		expect(
			findBreakingHubProtocolChanges(
				document(base, undefined, hubObject({})),
				toHubProtocolDocument({
					protocolVersion: "v1",
					envelopes: {},
					commands: {},
					events: {},
				}),
			),
		).toEqual(["command demo.run: removed", "event demo.done: removed"]);
	});
});
