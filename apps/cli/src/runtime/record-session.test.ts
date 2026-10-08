import { describe, expect, it } from "vitest";
import { recordSessionUnsupportedReason } from "./record-session";

describe("recordSessionUnsupportedReason", () => {
	const base = { acp: false, sandbox: false, backendMode: undefined };

	it("allows runs that can use the hub", () => {
		expect(recordSessionUnsupportedReason(base)).toBeUndefined();
		for (const backendMode of ["auto", "hub", " HUB "]) {
			expect(
				recordSessionUnsupportedReason({ ...base, backendMode }),
			).toBeUndefined();
		}
	});

	it("explains why ACP, sandboxed and non-hub backend runs cannot be recorded", () => {
		expect(recordSessionUnsupportedReason({ ...base, acp: true })).toContain(
			"--record-session cannot be combined with --acp",
		);
		expect(
			recordSessionUnsupportedReason({ ...base, sandbox: true }),
		).toContain("--record-session cannot be combined with --data-dir");
		expect(
			recordSessionUnsupportedReason({ ...base, backendMode: "Local" }),
		).toBe(
			"--record-session needs the hub, but CLINE_SESSION_BACKEND_MODE=local is set.",
		);
		expect(
			recordSessionUnsupportedReason({ ...base, backendMode: "remote" }),
		).toContain("CLINE_SESSION_BACKEND_MODE=remote");
	});
});
