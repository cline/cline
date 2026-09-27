import { describe, expect, it } from "vitest";
import {
	formatHistoryScopeLabel,
	getNextHistoryScope,
} from "./history-scoping";

describe("history scoping", () => {
	it("cycles scopes in order: current -> hierarchical -> all -> current", () => {
		expect(getNextHistoryScope("current")).toBe("hierarchical");
		expect(getNextHistoryScope("hierarchical")).toBe("all");
		expect(getNextHistoryScope("all")).toBe("current");
	});

	it("formats scope labels according to RFC 0001 Section 2.3", () => {
		expect(
			formatHistoryScopeLabel("current", 6, { isSubWorkspace: true }),
		).toBe("Current Sub-Workspace (6 sessions)");

		expect(
			formatHistoryScopeLabel("current", 12, { isSubWorkspace: false }),
		).toBe("Current Workspace (12 sessions)");

		expect(formatHistoryScopeLabel("hierarchical", 28)).toBe(
			"Entire Monorepo (28 sessions)",
		);

		expect(formatHistoryScopeLabel("all", 114)).toBe(
			"All Global Projects (114 sessions)",
		);
	});
});
