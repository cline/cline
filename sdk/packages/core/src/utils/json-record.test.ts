import { describe, expect, it } from "vitest";
import { cloneJsonRecord, stringifyJsonRecord } from "./json-record";

describe("json-record helpers", () => {
	it("converts session metadata into JSON-safe records", () => {
		const metadata: Record<string, unknown> = {
			startedAt: new Date("2026-07-07T00:00:00.000Z"),
			counter: 1n,
			nested: { ok: true },
			skipFunction: () => undefined,
		};
		metadata.self = metadata;
		Object.defineProperty(metadata, "badGetter", {
			enumerable: true,
			get() {
				throw new Error("metadata getter failed");
			},
		});

		const cloned = cloneJsonRecord(metadata);

		expect(cloned).toEqual({
			startedAt: "2026-07-07T00:00:00.000Z",
			counter: "1",
			nested: { ok: true },
			self: "[Circular]",
		});
	});

	it("stringifies JSON-safe metadata without throwing on circular values", () => {
		const metadata: Record<string, unknown> = { title: "session" };
		metadata.self = metadata;

		expect(JSON.parse(stringifyJsonRecord(metadata) ?? "")).toEqual({
			title: "session",
			self: "[Circular]",
		});
	});
});
