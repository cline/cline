import { describe, expect, it } from "vitest";
import { readPluginUiSlotCatalog } from "./catalog";

const SLOT = "composer.suggestions";

describe("readPluginUiSlotCatalog", () => {
	it("keeps known slot ids once", () => {
		expect(readPluginUiSlotCatalog([SLOT, SLOT, "x", 3])).toEqual([SLOT]);
	});

	it("reads anything but an array as no slots", () => {
		expect(readPluginUiSlotCatalog(undefined)).toEqual([]);
		expect(readPluginUiSlotCatalog({})).toEqual([]);
		expect(readPluginUiSlotCatalog(SLOT)).toEqual([]);
	});
});
