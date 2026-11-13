import { describe, expect, it } from "vitest";
import {
	selectInstalledHooks,
	selectInstalledRules,
	selectInstalledTools,
} from "./installed-inventory-selectors";

describe("installed inventory selectors", () => {
	it("keeps global rules before project rules and recognizes only workspace rule roots", () => {
		const rules = [
			{
				name: "Project",
				instructions: "",
				path: "C:\\repo\\.cline\\rules\\project.md",
			},
			{
				name: "Nested global",
				instructions: "",
				path: "C:\\repo\\other\\.cline\\rules\\global.md",
			},
			{ name: "Agents", instructions: "", path: "C:\\repo\\AGENTS.md" },
			{
				name: "Builtin",
				instructions: "",
				path: "builtin.md",
				source: "builtin",
			},
		];
		const original = rules.slice();
		expect(
			selectInstalledRules(
				{ rules, workspaceRoot: "C:\\repo\\" },
				{ includeBuiltinItems: false },
			).map(({ rule, scope }) => [rule.name, scope]),
		).toEqual([
			["Nested global", "Global"],
			["Project", "Project"],
			["Agents", "Project"],
		]);
		expect(rules).toEqual(original);
	});

	it.each([
		"  FORMAT  ",
		"style.md",
		"coding",
	])("searches rule names, instructions, and paths (%s)", (searchQuery) => {
		const rule = {
			name: "Coding",
			instructions: "Format carefully",
			path: "/repo/.cline/rules/style.md",
		};
		expect(
			selectInstalledRules(
				{ rules: [rule], workspaceRoot: "/repo" },
				{ searchQuery },
			),
		).toEqual([{ rule, scope: "Project" }]);
	});

	it("filters hooks by event or path while preserving scope and builtin visibility", () => {
		const project = {
			fileName: "format.sh",
			hookEventName: "AfterTool",
			path: "/repo/.clinerules/hooks/format.sh",
		};
		const global = {
			fileName: "audit.sh",
			hookEventName: "AfterTool",
			path: "/home/.clinerules/hooks/audit.sh",
		};
		const builtin = {
			fileName: "builtin.sh",
			hookEventName: "AfterTool",
			path: "builtin.sh",
			source: "builtin",
		};
		const inventory = {
			hooks: [project, global, builtin],
			workspaceRoot: "/repo",
		};
		expect(
			selectInstalledHooks(inventory, {
				searchQuery: " AFTERTOOL ",
				includeBuiltinItems: false,
			}),
		).toEqual([
			{ hook: global, scope: "Global" },
			{ hook: project, scope: "Project" },
		]);
		expect(selectInstalledHooks(inventory, { searchQuery: "/repo/" })).toEqual([
			{ hook: project, scope: "Project" },
		]);
		expect(selectInstalledHooks(inventory)).toHaveLength(3);
	});

	it("sorts tool groups without mutating inventory and searches headless aliases", () => {
		const tools = [
			{
				id: "z",
				name: "Zulu",
				enabled: true,
				source: "plugin",
				headlessToolNames: ["find_code"],
			},
			{
				id: "builtin",
				name: "Builtin",
				enabled: true,
				source: "builtin",
				headlessToolNames: ["find_code"],
			},
			{
				id: "a",
				name: "Alpha",
				enabled: false,
				source: "plugin",
				description: "Other tool",
			},
		];
		const original = tools.slice();
		const selected = selectInstalledTools(
			{ tools },
			{ searchQuery: " FIND_CODE " },
		);
		expect(selected.builtinTools).toEqual([tools[1]]);
		expect(selected.pluginTools).toEqual([tools[2], tools[0]]);
		expect(selected.filteredBuiltinTools).toEqual([tools[1]]);
		expect(selected.filteredPluginTools).toEqual([tools[0]]);
		expect(
			selectInstalledTools({ tools }, { includeBuiltinItems: false })
				.builtinTools,
		).toEqual([]);
		expect(tools).toEqual(original);
	});
});
