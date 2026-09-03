import { describe, expect, it } from "vitest";
import type { InteractiveConfigItem } from "../../tui/interactive-config";
import {
	canToggleConfigFooterRow,
	getAdjacentConfigTab,
	getConfigFooterText,
	getConfigItemDisplayName,
	getConfigPluginSections,
	getConfigTabCountHeading,
	isDeletableConfigItem,
	isInlineConfigAction,
	isToggleableConfigItem,
	resolveConfigItemDeleteAction,
	resolveConfigItemSelectAction,
	resolveConfigItemToggleAction,
	resolveInitialConfigTab,
	shouldRenderConfigItemAsEnabled,
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

	it("does not treat rule, agent, or hook rows as toggleable", () => {
		expect(isToggleableConfigItem(createItem({ kind: "rule" }))).toBe(false);
		expect(isToggleableConfigItem(createItem({ kind: "agent" }))).toBe(false);
		expect(isToggleableConfigItem(createItem({ kind: "hook" }))).toBe(false);
	});

	it("keeps plugin tool rows toggleable", () => {
		expect(
			isToggleableConfigItem(
				createItem({ kind: "tool", source: "workspace-plugin" }),
			),
		).toBe(true);
	});

	it("treats plugin rows as toggleable", () => {
		expect(isToggleableConfigItem(createItem({ kind: "plugin" }))).toBe(true);
	});

	it("treats MCP rows as toggleable", () => {
		expect(isToggleableConfigItem(createItem({ kind: "mcp" }))).toBe(true);
	});

	it("does not treat plugin MCP rows as toggleable", () => {
		expect(
			isToggleableConfigItem(
				createItem({
					kind: "mcp",
					pluginName: "plugin",
					source: "workspace-plugin",
				}),
			),
		).toBe(false);
	});

	it("lets users toggle hub-discovered Agent Plugins without deleting them", () => {
		const plugin = createItem({
			kind: "plugin",
			agentPlugin: true,
			toggleable: true,
			deletable: false,
			source: "global-plugin",
		});

		expect(isToggleableConfigItem(plugin)).toBe(true);
		expect(isDeletableConfigItem(plugin)).toBe(false);
		expect(resolveConfigItemToggleAction(plugin)).toEqual({
			kind: "toggle-item",
			item: plugin,
		});
		expect(resolveConfigItemDeleteAction(plugin)).toBeUndefined();
		expect(resolveConfigItemSelectAction(plugin)).toEqual({
			kind: "toggle-item",
			item: plugin,
		});
	});

	it("separates Cline and Agent Plugins into labeled sections", () => {
		const clinePlugin = createItem({
			kind: "plugin",
			name: "cline-plugin",
			source: "workspace-plugin",
		});
		const agentPlugin = createItem({
			kind: "plugin",
			name: "portable-plugin",
			source: "global-plugin",
			agentPlugin: true,
		});

		expect(getConfigPluginSections([clinePlugin, agentPlugin])).toEqual([
			{ label: "Cline Plugins (1)", items: [clinePlugin] },
			{ label: "Agent Plugins (1)", items: [agentPlugin] },
		]);
	});

	it("uses section counts instead of a combined Plugins heading", () => {
		expect(getConfigTabCountHeading("plugins", 10)).toBeUndefined();
		expect(getConfigTabCountHeading("skills", 20)).toBe("Skills (20)");
	});

	it("renders a loaded Agent Plugin as enabled", () => {
		const agentPlugin = createItem({
			kind: "plugin",
			agentPlugin: true,
			toggleable: true,
		});

		expect(shouldRenderConfigItemAsEnabled(agentPlugin, "enabled")).toBe(true);
		expect(shouldRenderConfigItemAsEnabled(agentPlugin, "disabled")).toBe(
			false,
		);
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

	it("mentions Space toggle in the footer for toggleable rows", () => {
		expect(getConfigFooterText({ canToggle: true })).toContain("Space toggle");
	});

	it("omits Space toggle in the footer for non-toggleable rows", () => {
		expect(getConfigFooterText({ canToggle: false })).not.toContain(
			"Space toggle",
		);
		expect(getConfigFooterText()).not.toContain("Space toggle");
	});

	it("derives footer toggle affordance from selected row behavior", () => {
		const skill = createItem({ kind: "skill" });
		const hook = createItem({ kind: "hook" });

		expect(canToggleConfigFooterRow({ kind: "provider" })).toBe(false);
		expect(canToggleConfigFooterRow({ kind: "toggle" })).toBe(true);
		expect(
			canToggleConfigFooterRow({
				kind: "ext",
				enabled: skill.enabled,
				item: skill,
			}),
		).toBe(true);
		expect(
			canToggleConfigFooterRow({
				kind: "ext",
				enabled: hook.enabled,
				item: hook,
			}),
		).toBe(false);
		expect(canToggleConfigFooterRow({ kind: "mcp-manager" })).toBe(false);
	});

	it("supports restoring and advancing the active settings tab", () => {
		expect(resolveInitialConfigTab("skills")).toBe("skills");
		expect(resolveInitialConfigTab(undefined)).toBe("general");
		expect(getAdjacentConfigTab("mcp", "right")).toBe("skills");
		expect(getAdjacentConfigTab("skills", "left")).toBe("mcp");
	});

	it("handles toggle actions inline so the settings dialog stays open", () => {
		const skill = createItem({ kind: "skill", name: "review" });
		const plugin = createItem({ kind: "plugin", name: "workspace-plugin" });
		const mcp = createItem({ kind: "mcp", name: "docs" });
		const builtinTool = createItem({
			kind: "tool",
			name: "read_file",
			source: "builtin",
		});

		expect(isInlineConfigAction(resolveConfigItemToggleAction(skill))).toBe(
			true,
		);
		expect(isInlineConfigAction(resolveConfigItemSelectAction(skill))).toBe(
			false,
		);
		expect(isInlineConfigAction(resolveConfigItemSelectAction(plugin))).toBe(
			true,
		);
		expect(isInlineConfigAction(resolveConfigItemSelectAction(mcp))).toBe(true);
		expect(
			isInlineConfigAction(resolveConfigItemSelectAction(builtinTool)),
		).toBe(true);
		expect(getConfigFooterText({ canToggle: true })).not.toContain("details");
	});

	it("returns item names without decoration", () => {
		expect(getConfigItemDisplayName("review")).toBe("review");
	});
});
