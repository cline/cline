import { describe, expect, it } from "vitest";
import type { InteractiveConfigItem } from "../../tui/interactive-config";
import {
	getAdjacentConfigTab,
	getConfigFooterText,
	getConfigItemDisplayName,
	isInlineConfigAction,
	isToggleableConfigItem,
	resolveConfigItemSelectAction,
	resolveConfigItemToggleAction,
	resolveInitialConfigTab,
} from "./config-view-helpers";

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

describe("config view helpers", () => {
	it("treats skill rows as toggleable", () => {
		expect(isToggleableConfigItem(createItem({ kind: "skill" }))).toBe(true);
	});

	it("does not treat workflow rows as toggleable", () => {
		expect(isToggleableConfigItem(createItem({ kind: "workflow" }))).toBe(
			false,
		);
	});

	it("keeps plugin tool rows toggleable", () => {
		expect(
			isToggleableConfigItem(
				createItem({ kind: "tool", source: "workspace-plugin" }),
			),
		).toBe(true);
	});

	it("resolves Enter/Tab on a skill row to details", () => {
		const skill = createItem({
			kind: "skill",
			name: "review",
			path: "/tmp/review/SKILL.md",
			source: "workspace",
		});

		expect(resolveConfigItemSelectAction(skill)).toEqual({
			kind: "ext-detail",
			item: skill,
		});
	});

	it("resolves Space on a skill row to toggle", () => {
		const skill = createItem({ kind: "skill", name: "review" });

		expect(resolveConfigItemToggleAction(skill)).toEqual({
			kind: "toggle-item",
			item: skill,
		});
	});

	it("mentions Space toggle in the footer", () => {
		expect(getConfigFooterText()).toContain("Space toggle");
	});

	it("supports restoring and advancing the active settings tab", () => {
		expect(resolveInitialConfigTab("skills")).toBe("skills");
		expect(resolveInitialConfigTab(undefined)).toBe("general");
		expect(getAdjacentConfigTab("mcp", "right")).toBe("skills");
		expect(getAdjacentConfigTab("skills", "left")).toBe("mcp");
	});

	it("handles toggle actions inline so the settings dialog stays open", () => {
		const skill = createItem({ kind: "skill", name: "review" });

		expect(isInlineConfigAction(resolveConfigItemToggleAction(skill))).toBe(
			true,
		);
		expect(isInlineConfigAction(resolveConfigItemSelectAction(skill))).toBe(
			false,
		);
	});

	it("returns item names without decoration", () => {
		expect(getConfigItemDisplayName("review")).toBe("review");
	});
});
