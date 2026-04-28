import { describe, expect, it } from "vitest";
import {
	buildSlashCommandRegistry,
	expandUserCommandPrompt,
	formatSlashCommandAutocompleteValue,
	getVisibleSystemSlashCommands,
	getVisibleUserSlashCommands,
	resolveSlashCommand,
} from "./slash-command-registry";

describe("slash command registry", () => {
	it("keeps TUI-local commands local even when runtime also advertises them", () => {
		const registry = buildSlashCommandRegistry({
			canFork: true,
			workflowSlashCommands: [
				{
					name: "settings",
					instructions: "",
					description: "Runtime settings",
				},
				{
					name: "team",
					instructions: "/team [prompt]",
					description: "Start a task with agent team",
				},
				{
					name: "mcp",
					instructions: "",
					description: "Runtime MCP",
				},
			],
		});

		expect(resolveSlashCommand(registry, "settings")).toMatchObject({
			source: "tui",
			execution: "local",
			description: "Modify agent configuration",
			visible: true,
		});
		expect(resolveSlashCommand(registry, "team")).toMatchObject({
			source: "runtime",
			execution: "runtime",
		});
		expect(resolveSlashCommand(registry, "mcp")).toMatchObject({
			source: "tui",
			execution: "local",
			description: "Manage MCP servers",
			visible: true,
		});
	});

	it("surfaces plugin commands as runtime-executable commands", () => {
		const registry = buildSlashCommandRegistry({
			additionalSlashCommands: [
				{
					name: "/Echo",
					instructions: "",
					description: "Echo input",
				},
			],
		});
		const command = resolveSlashCommand(registry, "echo");

		expect(command).toMatchObject({
			name: "echo",
			source: "plugin",
			execution: "runtime",
			visible: true,
			selectable: true,
		});
		expect(command ? formatSlashCommandAutocompleteValue(command) : "").toBe(
			"/echo ",
		);
	});

	it("surfaces skills and workflows as user command blocks", () => {
		const registry = buildSlashCommandRegistry({
			workflowSlashCommands: [
				{
					name: "review",
					instructions: "Review carefully",
					description: "Review files",
					kind: "skill",
				},
				{
					name: "release",
					instructions: "Prepare release",
					description: "Release workflow",
					kind: "workflow",
				},
			],
		});

		expect(
			getVisibleSystemSlashCommands(registry).map((cmd) => cmd.name),
		).toEqual(
			expect.arrayContaining(["settings", "mcp", "account", "model", "quit"]),
		);
		expect(resolveSlashCommand(registry, "quit")).toMatchObject({
			source: "tui",
			execution: "local",
			description: "Exit Cline",
			visible: true,
		});
		expect(
			getVisibleUserSlashCommands(registry).map((cmd) => cmd.name),
		).toEqual(["review", "release"]);
		const review = resolveSlashCommand(registry, "review");
		expect(review ? formatSlashCommandAutocompleteValue(review) : "").toBe(
			"/review ",
		);
	});

	it("expands user command tokens and manually typed user commands before submission", () => {
		const registry = buildSlashCommandRegistry({
			workflowSlashCommands: [
				{
					name: "review",
					instructions: "Review carefully",
					description: "Review files",
					kind: "skill",
				},
			],
		});

		expect(expandUserCommandPrompt("/review this file", registry)).toBe(
			'<user_command slash="review">Review carefully</user_command> this file',
		);
		expect(expandUserCommandPrompt("please /review this file", registry)).toBe(
			'please <user_command slash="review">Review carefully</user_command> this file',
		);
		expect(
			expandUserCommandPrompt(
				'<user_command slash="review">Review carefully</user_command> this file',
				registry,
			),
		).toBe(
			'<user_command slash="review">Review carefully</user_command> this file',
		);
		expect(expandUserCommandPrompt("/settings", registry)).toBe("/settings");
	});

	it("hides fork from autocomplete until a session has messages", () => {
		const emptySessionRegistry = buildSlashCommandRegistry({ canFork: false });
		const activeSessionRegistry = buildSlashCommandRegistry({ canFork: true });

		expect(resolveSlashCommand(emptySessionRegistry, "fork")).toMatchObject({
			execution: "local",
			visible: false,
			selectable: false,
		});
		expect(
			getVisibleSystemSlashCommands(emptySessionRegistry).map(
				(command) => command.name,
			),
		).not.toContain("fork");
		expect(
			getVisibleSystemSlashCommands(activeSessionRegistry).map(
				(command) => command.name,
			),
		).toContain("fork");
	});

	it("keeps config as a hidden alias for settings", () => {
		const registry = buildSlashCommandRegistry({ canFork: true });

		expect(resolveSlashCommand(registry, "config")).toMatchObject({
			source: "tui",
			execution: "local",
			description: "Modify agent configuration",
			visible: false,
			selectable: false,
		});
		expect(
			getVisibleSystemSlashCommands(registry).map((command) => command.name),
		).not.toContain("config");
		expect(
			getVisibleSystemSlashCommands(registry).map((command) => command.name),
		).toContain("settings");
	});

	it("hides the account command when Cline account is not active", () => {
		const registry = buildSlashCommandRegistry({
			showClineAccountCommand: false,
		});

		expect(resolveSlashCommand(registry, "account")).toBeUndefined();
		expect(
			getVisibleSystemSlashCommands(registry).map((command) => command.name),
		).not.toContain("account");
	});
});
