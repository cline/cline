import { describe, expect, it } from "vitest";
import { getShowTemplate, SHOW_TEMPLATE_KIT } from "./showTemplates.js";

describe("SHOW_TEMPLATE_KIT", () => {
	it("includes architecture and walkthrough templates", () => {
		expect(SHOW_TEMPLATE_KIT.length).toBeGreaterThanOrEqual(5);
		expect(getShowTemplate("arch.overview")?.artifactKind).toBe(
			"diagram.architecture",
		);
		expect(getShowTemplate("walk.code")?.artifactKind).toBe(
			"walkthrough.code",
		);
	});
});
