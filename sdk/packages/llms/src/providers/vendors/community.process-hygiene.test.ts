import { describe, expect, it } from "vitest";
import { expectSapLoadLeavesOnlyHostListeners } from "./community.process-hygiene.helpers";

// One test per file: vitest runs each file in a fresh process, which is what
// makes this the first SAP load. The failure path is in its own file.
describe("SAP provider process hygiene", () => {
	it("removes the SAP SDK's exit handlers and keeps host listeners registered mid-load", async () => {
		const { rejected } = await expectSapLoadLeavesOnlyHostListeners();
		expect(rejected).toBe(false);
	});
});
