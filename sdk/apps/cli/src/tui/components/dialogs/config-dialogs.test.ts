import { describe, expect, it } from "vitest";
import type { InteractiveConfigItem } from "../../interactive-config";
import {
	getExtDetailFooterText,
	getExtDetailRows,
	shouldCloseExtDetailForKey,
	shouldToggleExtDetailForKey,
} from "./config-dialogs-helpers";

function createItem(
	overrides: Partial<InteractiveConfigItem> &
		Pick<InteractiveConfigItem, "kind">,
): InteractiveConfigItem {
	return {
		id: "item-id",
		name: "item-name",
		path: "/tmp/item",
		enabled: true,
		source: "workspace",
		...overrides,
	};
}

describe("config detail dialog helpers", () => {
	it("closes details for Enter, Escape, and Tab", () => {
		expect(shouldCloseExtDetailForKey("return")).toBe(true);
		expect(shouldCloseExtDetailForKey("escape")).toBe(true);
		expect(shouldCloseExtDetailForKey("tab")).toBe(true);
		expect(shouldCloseExtDetailForKey("space")).toBe(false);
	});

	it("toggles detail status on Space only for toggleable rows", () => {
		const skill = createItem({ kind: "skill" });
		const workflow = createItem({ kind: "workflow" });

		expect(shouldToggleExtDetailForKey("space", skill)).toBe(true);
		expect(shouldToggleExtDetailForKey("return", skill)).toBe(false);
		expect(shouldToggleExtDetailForKey("space", workflow)).toBe(false);
	});

	it("builds useful detail rows with status for toggleable items", () => {
		expect(
			getExtDetailRows(
				createItem({
					kind: "skill",
					name: "add-model",
					source: "global",
					path: "/tmp/add-model/SKILL.md",
					description: "Add a model safely",
					enabled: false,
				}),
			),
		).toEqual([
			{ kind: "header", name: "add-model", source: "global" },
			{ kind: "field", label: "Path", value: ["/tmp/add-model/SKILL.md"] },
			{ kind: "field", label: "Description", value: ["Add a model safely"] },
			{ kind: "status", enabled: false },
		]);
	});

	it("omits status and toggle hint for non-toggleable items", () => {
		const workflow = createItem({
			kind: "workflow",
			name: "release",
			description: "Run release workflow",
		});

		expect(getExtDetailRows(workflow)).toEqual([
			{ kind: "header", name: "release", source: "workspace" },
			{ kind: "field", label: "Path", value: ["/tmp/item"] },
			{ kind: "field", label: "Description", value: ["Run release workflow"] },
		]);
		expect(getExtDetailFooterText(workflow)).toBe("Tab/Enter/Esc to go back");
	});

	it("shows toggle hint for toggleable items", () => {
		expect(getExtDetailFooterText(createItem({ kind: "skill" }))).toBe(
			"Space toggle status, Tab/Enter/Esc to go back",
		);
	});

	it("bounds long descriptions so path and status remain visible", () => {
		const rows = getExtDetailRows(
			createItem({
				kind: "skill",
				name: "karpathy-rules",
				source: "global",
				path: "/tmp/karpathy-rules.md",
				description: Array.from(
					{ length: 30 },
					(_, index) => `Long rule line ${index + 1}`,
				).join("\n"),
				enabled: true,
			}),
		);

		expect(rows[1]).toEqual({
			kind: "field",
			label: "Path",
			value: ["/tmp/karpathy-rules.md"],
		});
		expect(rows[2]?.kind).toBe("field");
		if (rows[2]?.kind === "field") {
			expect(rows[2].label).toBe("Description");
			expect(rows[2].value).toHaveLength(13);
			expect(rows[2].value.at(-1)).toContain("… truncated");
		}
		expect(rows[3]).toEqual({ kind: "status", enabled: true });
	});

	it("wraps long description lines before truncating", () => {
		const rows = getExtDetailRows(
			createItem({
				kind: "rule",
				description: "a ".repeat(120).trim(),
			}),
		);

		expect(rows[2]?.kind).toBe("field");
		if (rows[2]?.kind === "field") {
			expect(rows[2].value.length).toBeGreaterThan(1);
			expect(rows[2].value.every((line) => line.length <= 78)).toBe(true);
		}
	});
});
