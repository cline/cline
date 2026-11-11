import { expect, it } from "vitest";
import { revealActionLabel } from "./reveal-label";

it.each([
	[
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
		"Reveal in Finder",
	],
	[
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
		"Show in File Explorer",
	],
	[
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
		"Open containing folder",
	],
	// Test runners report the host as "(darwin)", which must not read as Windows.
	[
		"Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.0.0",
		"Open containing folder",
	],
	["", "Open containing folder"],
])("names the reveal action for %s", (userAgent, label) => {
	expect(revealActionLabel(userAgent)).toBe(label);
});
