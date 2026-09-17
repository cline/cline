// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CombinedPatterns,
	SourcePatterns,
	UsagePatternsReport,
} from "@/lib/usage-types";
import { UsageContent } from "./usage-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: vi.fn(() => () => {}) },
}));
// jsdom has no 2D canvas; stand in a canvas that can still produce a PNG URL.
vi.mock("@/lib/share-card", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/share-card")>(
			"@/lib/share-card",
		);
	return {
		...actual,
		renderShareCard: () => {
			const canvas = document.createElement("canvas");
			canvas.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
			return canvas;
		},
	};
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	invoke.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function patterns(sessions: number, subagents: number): CombinedPatterns {
	const roots = sessions - subagents;
	const hourHistogram = Array.from({ length: 24 }, (_, hour) =>
		hour === 9 ? Math.max(0, roots - 1) : hour === 2 ? Math.min(1, roots) : 0,
	);
	return {
		rhythm: {
			hourHistogram,
			weekdayHourMatrix: Array.from({ length: 7 }, (_, weekday) =>
				hourHistogram.map((count) => (weekday === 0 ? count : 0)),
			),
			daily: roots > 0 ? [{ date: "2026-03-02", started: roots }] : [],
			activeDays: roots > 0 ? 3 : 0,
			firstActiveMs: roots > 0 ? Date.parse("2026-03-02T09:00:00") : null,
			currentStreakDays: roots > 0 ? 2 : 0,
			longestStreakDays: roots > 0 ? 3 : 0,
			peakHour: roots > 0 ? 9 : null,
			nightShare: roots > 0 ? 0.25 : 0,
		},
		workflow: {
			sessions,
			rootSessions: roots,
			subagentSessions: subagents,
			orchestrationShare: sessions === 0 ? 0 : subagents / sessions,
			maxDepth: subagents > 0 ? 2 : 0,
			depthHistogram: subagents > 0 ? { "1": subagents - 1, "2": 1 } : {},
		},
		projects:
			sessions > 0
				? [
						{
							project: "GitHub/demo",
							sessions,
							activeDays: 1,
							lastActiveMs: 0,
							subagentSessions: subagents,
						},
					]
				: [],
		lifecycle: { terminalSessions: 4, failedSessions: 1 },
	};
}

function source(
	sourceId: SourcePatterns["availability"]["source"],
	options: { installed?: boolean; sessions?: number; subagents?: number } = {},
): SourcePatterns {
	const sessions = options.sessions ?? 0;
	const subagents = options.subagents ?? 0;
	const roots = sessions - subagents;
	return {
		...patterns(sessions, subagents),
		availability: {
			source: sourceId,
			installed: options.installed ?? true,
			root: `/stores/${sourceId}`,
			coverage: {
				scanned: sessions + 2,
				recognized: sessions,
				skipped: sessions > 0 ? { "unrecognized format": 2 } : {},
				oldestSessionMs: Date.parse("2026-02-01T09:00:00"),
			},
		},
		span: {
			buckets: {
				under10m: Math.max(0, roots - 3),
				under1h: Math.min(1, roots),
				under4h: 0,
				under24h: 1,
				over24h: 1,
			},
		},
	};
}

function report(
	sources: SourcePatterns[],
	rangeDays = 30,
): UsagePatternsReport {
	const sessions = sources.reduce((sum, s) => sum + s.workflow.sessions, 0);
	const subagents = sources.reduce(
		(sum, s) => sum + s.workflow.subagentSessions,
		0,
	);
	return {
		generatedAtMs: Date.parse("2026-03-08T12:00:00"),
		scanMs: 12,
		rangeDays,
		sources,
		combined: patterns(sessions, subagents),
	};
}

async function settle() {
	await act(async () => {
		await Promise.resolve();
	});
}

async function render() {
	await act(async () => {
		root.render(<UsageContent />);
	});
	await settle();
}

function button(
	label: string,
	scope: ParentNode = container,
): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) =>
		element.textContent?.includes(label),
	);
	if (!found) throw new Error(`no button "${label}"`);
	return found;
}

function click(label: string, scope: ParentNode = container) {
	act(() => button(label, scope).click());
}

describe("UsageContent", () => {
	it("renders the combined rhythm, orchestration and project patterns", async () => {
		invoke.mockResolvedValue(
			report([source("codex", { sessions: 10, subagents: 6 })]),
		);
		await render();

		expect(invoke).toHaveBeenCalledWith(
			"get_usage_patterns",
			{ rangeDays: 30, refresh: false },
			expect.anything(),
		);
		const text = container.textContent ?? "";
		expect(text).toContain("Sessions started");
		expect(text).toContain("60%"); // orchestration share
		expect(text).toContain("25%"); // night share
		expect(text).toContain("GitHub/demo"); // top project
		expect(text).toContain("depth 1"); // orchestration chart
		expect(text).toContain("3 active of 30 days");
		expect(text).toContain("10m-1h");
		// One heatmap row per weekday, one cell per hour.
		expect(container.querySelectorAll('[title^="Mon "]').length).toBe(24);
	});

	it("renders one span bar per source and keeps legend items on one line", async () => {
		invoke.mockResolvedValue(
			report([
				source("codex", { sessions: 10, subagents: 6 }),
				source("claude-code", { sessions: 4 }),
			]),
		);
		await render();
		// Per source, never summed: the stores measure span differently.
		expect(
			container.querySelectorAll("[data-testid=span-source-row]").length,
		).toBe(2);
		const legend = [
			...container.querySelectorAll("[data-testid=span-legend-item]"),
		];
		expect(legend.length).toBe(5);
		for (const item of legend) {
			expect(item.className).toContain("whitespace-nowrap");
		}
		expect(container.textContent).toContain("per source instead of summed");
	});

	it("shows how far each store's history goes and what it skipped", async () => {
		invoke.mockResolvedValue(report([source("codex", { sessions: 5 })], 90));
		await render();
		const text = container.textContent ?? "";
		expect(text).toContain("history since");
		expect(text).toContain("2 files skipped");
	});

	it("marks a source that is not installed and disables its filter", async () => {
		invoke.mockResolvedValue(
			report([
				source("codex", { sessions: 3 }),
				source("claude-code", { installed: false }),
			]),
		);
		await render();
		expect(container.textContent).toContain("Claude Code (not installed)");
		expect(button("Claude Code").disabled).toBe(true);
	});

	it("shows the empty state and has nothing to share", async () => {
		invoke.mockResolvedValue(report([source("codex", { sessions: 0 })]));
		await render();
		expect(container.textContent).toContain(
			"No sessions found in the last 30 days",
		);
		expect(button("Share").disabled).toBe(true);
	});

	it("rescans for the new window when the range changes, and on refresh", async () => {
		invoke.mockResolvedValue(report([source("codex", { sessions: 1 })]));
		await render();
		click("7d");
		await settle();
		expect(invoke).toHaveBeenLastCalledWith(
			"get_usage_patterns",
			{ rangeDays: 7, refresh: false },
			expect.anything(),
		);
		click("Refresh");
		await settle();
		expect(invoke).toHaveBeenLastCalledWith(
			"get_usage_patterns",
			{ rangeDays: 7, refresh: true },
			expect.anything(),
		);
	});

	it("shows the card preview as soon as the share dialog opens", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "export_usage_share_card") {
				return {
					path: "/Users/me/Downloads/cline-usage-30d-20260308.png",
					platform: "darwin",
				};
			}
			return report([source("codex", { sessions: 5, subagents: 2 })]);
		});
		await render();
		click("Share");
		await settle();

		// Radix renders dialog content in a portal on document.body.
		const preview = document.body.querySelector<HTMLImageElement>(
			'img[alt="Usage profile share card preview"]',
		);
		expect(preview?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
		expect(document.body.textContent).toContain("Share your usage profile");

		click("Save PNG", document.body);
		await settle();
		expect(invoke).toHaveBeenCalledWith(
			"export_usage_share_card",
			expect.objectContaining({ png: "data:image/png;base64,iVBORw0KGgo=" }),
			expect.anything(),
		);
		click("Show in Finder", document.body);
		await settle();
		expect(invoke).toHaveBeenLastCalledWith("reveal_usage_share_card", {
			path: "/Users/me/Downloads/cline-usage-30d-20260308.png",
		});
	});

	it("surfaces a scan error instead of an empty chart", async () => {
		invoke.mockRejectedValue(new Error("sidecar offline"));
		await render();
		expect(container.textContent).toContain("sidecar offline");
	});
});
