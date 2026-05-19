import { describe, expect, it } from "vitest";
import {
	buildSlashCommandRegistry,
	getVisibleSystemSlashCommands,
} from "../../commands/slash-command-registry";
import {
	buildCommandPaletteItems,
	filterCommandPaletteItems,
	findCommandPaletteShortcut,
} from "./command-palette-items";

describe("command palette", () => {
	it("builds action-only palette items with shortcuts", () => {
		const items = buildCommandPaletteItems({
			canForkSession: false,
		});
		const labels = items.map((item) => item.label);

		expect(labels).toContain("Change Provider");
		expect(labels).toContain("Manage MCP Servers");
		expect(labels).toContain("Compact Context");
		expect(labels).not.toContain("/settings");
		expect(labels).not.toContain("Toggle Plan/Act Mode");
		expect(labels).not.toContain("Toggle Auto-Approve");
		expect(labels).not.toContain("Create Session Fork");
		expect(items.every((item) => item.shortcut.startsWith("Opt+"))).toBe(true);
		expect(items.map((item) => item.shortcut)).not.toContain("Opt+?");
	});

	it("shows fork only when the current session can be forked", () => {
		const items = buildCommandPaletteItems({
			canForkSession: true,
		});

		expect(items.map((item) => item.label)).toContain("Create Session Fork");
	});

	it("covers visible local slash commands with palette wording", () => {
		const registry = buildSlashCommandRegistry({
			canFork: true,
		});
		const slashCommands = getVisibleSystemSlashCommands(registry).filter(
			(command) => command.source === "tui" && command.name !== "config",
		);
		const items = buildCommandPaletteItems({
			canForkSession: true,
		});
		const paletteByCommandName = new Map(
			items.map((item) => [
				item.result.action === "change-model" ? "model" : item.result.action,
				item,
			]),
		);

		for (const command of slashCommands) {
			expect(paletteByCommandName.has(command.name)).toBe(true);
		}
		expect(paletteByCommandName.get("settings")?.description).toBe(
			"Review and edit CLI configuration",
		);
	});

	it("ranks direct actions over lower confidence matches", () => {
		const items = buildCommandPaletteItems({
			canForkSession: true,
		});

		expect(filterCommandPaletteItems(items, "provider")[0]?.label).toBe(
			"Change Provider",
		);
		expect(filterCommandPaletteItems(items, "mcp")[0]?.label).toBe(
			"Manage MCP Servers",
		);
		expect(filterCommandPaletteItems(items, "opt m")[0]?.label).toBe(
			"Change Model",
		);
	});

	it("finds opt shortcut matches without using searchable text input keys", () => {
		const items = buildCommandPaletteItems({
			canForkSession: true,
		});

		expect(
			findCommandPaletteShortcut(items, {
				name: "m",
				meta: true,
				option: false,
				shift: false,
			})?.label,
		).toBe("Change Model");
		expect(
			findCommandPaletteShortcut(items, {
				name: "m",
				meta: false,
				option: true,
				shift: false,
			})?.label,
		).toBe("Change Model");
		expect(
			findCommandPaletteShortcut(items, {
				name: "m",
				meta: false,
				option: false,
				shift: false,
			}),
		).toBeUndefined();
		expect(
			findCommandPaletteShortcut(items, {
				name: "k",
				meta: true,
				option: false,
				shift: false,
			})?.label,
		).toBe("Open Help");
	});
});
