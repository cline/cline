import { describe, expect, it } from "vitest";

import { buildCardReference } from "./card-thread";

describe("buildCardReference", () => {
	it("names the card the message belongs to, above it", () => {
		expect(buildCardReference("73bf8", "Ready for review")).toBe(
			"↳ 73bf8\nReady for review",
		);
	});

	// The anchor already carries the dot and the title. A second dot in the same thread, for
	// the same card, is the confusion this was meant to remove.
	it("carries no column dot of its own", () => {
		expect(buildCardReference("73bf8", "Ready for review")).not.toMatch(
			/[⚪🔵🟠🟢🔴]/u,
		);
	});
});
