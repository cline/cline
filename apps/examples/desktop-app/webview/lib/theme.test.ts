// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	applyHubAccent,
	DEFAULT_HUB_ACCENT,
	HUB_ACCENT_STORAGE_KEY,
	isHubAccent,
	readStoredHubAccent,
	setStoredHubAccent,
	syncHubAccent,
} from "./theme";

afterEach(() => {
	window.localStorage.clear();
	delete document.documentElement.dataset.clineAccent;
});

describe("hub accent", () => {
	it("defaults to violet and validates stored values", () => {
		expect(readStoredHubAccent()).toBe(DEFAULT_HUB_ACCENT);
		window.localStorage.setItem(HUB_ACCENT_STORAGE_KEY, "not-a-color");
		expect(readStoredHubAccent()).toBe(DEFAULT_HUB_ACCENT);
		expect(isHubAccent("ember")).toBe(true);
		expect(isHubAccent("magenta")).toBe(false);
	});

	it("round-trips through storage and the html dataset", () => {
		setStoredHubAccent("graphite");
		expect(window.localStorage.getItem(HUB_ACCENT_STORAGE_KEY)).toBe(
			"graphite",
		);
		expect(document.documentElement.dataset.clineAccent).toBe("graphite");

		expect(syncHubAccent()).toBe("graphite");
		expect(document.documentElement.dataset.clineAccent).toBe("graphite");
	});

	it("clears the dataset attribute for the default accent", () => {
		applyHubAccent("ember");
		expect(document.documentElement.dataset.clineAccent).toBe("ember");
		applyHubAccent(DEFAULT_HUB_ACCENT);
		expect(document.documentElement.dataset.clineAccent).toBeUndefined();
	});
});
