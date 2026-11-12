// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	readFactoryManagerPanelOpen,
	readFactoryManagerSessionId,
	withOpenCardLine,
	writeFactoryManagerPanelOpen,
	writeFactoryManagerSessionId,
} from "./factory-manager-panel";
import { ensureLocalStorage } from "./test-local-storage";

beforeEach(() => {
	ensureLocalStorage();
	window.localStorage.clear();
});

describe("Ask Factory panel state", () => {
	it("remembers whether the panel is open and which conversation it shows", () => {
		expect(readFactoryManagerPanelOpen()).toBe(false);
		writeFactoryManagerPanelOpen(true);
		expect(readFactoryManagerPanelOpen()).toBe(true);
		writeFactoryManagerPanelOpen(false);
		expect(readFactoryManagerPanelOpen()).toBe(false);

		expect(readFactoryManagerSessionId()).toBeNull();
		writeFactoryManagerSessionId("session-1");
		expect(readFactoryManagerSessionId()).toBe("session-1");
		writeFactoryManagerSessionId(null);
		expect(readFactoryManagerSessionId()).toBeNull();
	});

	it("names the open card by short id as a final line only while there is one", () => {
		expect(withOpenCardLine("How is this card going?", "F25")).toBe(
			"How is this card going?\n\nOpen card: F25",
		);
		expect(withOpenCardLine("What needs me?", undefined)).toBe(
			"What needs me?",
		);
	});
});
