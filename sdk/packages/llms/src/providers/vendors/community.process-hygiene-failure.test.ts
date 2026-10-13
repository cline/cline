import { describe, expect, it } from "vitest";
import { expectSapLoadLeavesOnlyHostListeners } from "./community.process-hygiene.helpers";

// One test per file: vitest runs each file in a fresh process, which is what
// makes this the first SAP load. The success path is in its own file.
describe("SAP provider process hygiene on a failed construction", () => {
	it("removes the SAP SDK's exit handlers even when the first construction rejects", async () => {
		// The provider validates modelParams synchronously, after the import.
		const { rejected } = await expectSapLoadLeavesOnlyHostListeners({
			modelParams: { maxTokens: -1 },
		});
		expect(rejected).toBe(true);
	});
});
