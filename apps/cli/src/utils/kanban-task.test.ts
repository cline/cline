import { describe, expect, it, vi } from "vitest";

import {
	buildBrainstormPrompt,
	buildKanbanCreateArgs,
	createKanbanTask,
	deriveTaskTitle,
	parseTaskCommand,
	readCreatedTaskId,
} from "./kanban-task";

const OK = '{"ok":true,"task":{"id":"65f2d","title":"x"}}';

describe("deriveTaskTitle", () => {
	it("uses the first line as written when it is short", () => {
		expect(
			deriveTaskTitle("Congelar a margem no aceite\n\ndetalhe longo"),
		).toBe("Congelar a margem no aceite");
	});

	it("collapses the whitespace people leave when typing on a phone", () => {
		expect(deriveTaskTitle("  medir   a    suite ")).toBe("medir a suite");
	});

	it("cuts a long line at a word boundary", () => {
		const title = deriveTaskTitle(
			"renomear own_portfolio porque o nome mente sobre o que a coluna guarda hoje",
		);
		expect(title.endsWith("…")).toBe(true);
		expect(title.length).toBeLessThanOrEqual(61);
		expect(title).not.toMatch(/\s…$/);
		// A word boundary, not a mid-word slice.
		expect(
			"renomear own_portfolio porque o nome mente sobre o que a coluna guarda hoje",
		).toContain(title.slice(0, -1));
	});

	it("still clips a single unbroken run that has no boundary to use", () => {
		const title = deriveTaskTitle("a".repeat(200));
		expect(title).toBe(`${"a".repeat(60)}…`);
	});
});

describe("buildKanbanCreateArgs", () => {
	it("sends the full text as the prompt and the derived line as the title", () => {
		const args = buildKanbanCreateArgs({
			description: "Titulo curto\ncorpo com detalhe",
			projectPath: "/code/partyshare",
		});
		expect(args).toEqual([
			"task",
			"create",
			"--title",
			"Titulo curto",
			"--prompt",
			"Titulo curto\ncorpo com detalhe",
			"--project-path",
			"/code/partyshare",
		]);
	});
});

describe("readCreatedTaskId", () => {
	it("finds the object even behind a node warning on stdout", () => {
		expect(
			readCreatedTaskId(`(node:1) DeprecationWarning: whatever\n${OK}`),
		).toBe("65f2d");
	});

	it("returns nothing for output that is not the expected shape", () => {
		expect(readCreatedTaskId("")).toBeUndefined();
		expect(readCreatedTaskId("not json at all")).toBeUndefined();
		expect(readCreatedTaskId('{"ok":false,"task":{"id":"x"}}')).toBeUndefined();
		expect(readCreatedTaskId('{"ok":true,"task":{}}')).toBeUndefined();
	});
});

describe("createKanbanTask", () => {
	it("creates the card in the conversation's repository", async () => {
		const run = vi.fn<(args: string[]) => Promise<{ stdout: string }>>(
			async () => ({
				stdout: OK,
			}),
		);
		const result = await createKanbanTask(
			{ description: "Congelar a margem", projectPath: "/code/partyshare" },
			{ run },
		);
		expect(result.ok).toBe(true);
		expect(result.taskId).toBe("65f2d");
		expect(run.mock.calls[0]?.[0]).toContain("/code/partyshare");
	});

	it("asks for a description instead of creating an empty card", async () => {
		const run = vi.fn(async () => ({ stdout: OK }));
		const result = await createKanbanTask(
			{ description: "   ", projectPath: "/code/app" },
			{ run },
		);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("Usage:");
		expect(run).not.toHaveBeenCalled();
	});

	it("says plainly that the board is not running", async () => {
		const result = await createKanbanTask(
			{ description: "x", projectPath: "/code/app" },
			{
				run: async () => {
					throw Object.assign(new Error("fetch failed"), {
						stderr: "fetch failed",
					});
				},
			},
		);
		expect(result.ok).toBe(false);
		expect(result.message).toBe(
			"Could not reach Kanban. Is the board running?",
		);
	});

	it("says plainly that Kanban is not installed", async () => {
		const result = await createKanbanTask(
			{ description: "x", projectPath: "/code/app" },
			{
				run: async () => {
					throw Object.assign(new Error("spawn kanban ENOENT"), {
						code: "ENOENT",
					});
				},
			},
		);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("not installed");
	});

	it("does not claim success when Kanban answers without an id", async () => {
		const result = await createKanbanTask(
			{ description: "x", projectPath: "/code/app" },
			{ run: async () => ({ stdout: '{"ok":true}' }) },
		);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("did not report a task id");
	});
});

describe("parseTaskCommand", () => {
	it("reads the flags that lead the line", () => {
		expect(
			parseTaskCommand(["--start", "--brainstorm", "fazer", "algo"]),
		).toEqual({
			start: true,
			brainstorm: true,
			description: "fazer algo",
		});
	});

	it("leaves a flag alone once the demand has started", () => {
		// A demand is free to be about a flag. Reading flags anywhere would eat the subject.
		expect(
			parseTaskCommand(["--start", "fix", "the", "--dry-run", "flag"]),
		).toEqual({
			start: true,
			brainstorm: false,
			description: "fix the --dry-run flag",
		});
	});

	it("defaults to filing without starting", () => {
		expect(parseTaskCommand(["medir", "a", "suite"])).toEqual({
			start: false,
			brainstorm: false,
			description: "medir a suite",
		});
	});

	it("reports an empty demand so the caller can show usage", () => {
		expect(parseTaskCommand([]).description).toBe("");
		expect(parseTaskCommand(["--start"]).description).toBe("");
	});
});

describe("createKanbanTask with --start", () => {
	it("starts the session after the card exists", async () => {
		const calls: string[][] = [];
		const result = await createKanbanTask(
			{
				description: "medir a suite",
				projectPath: "/code/partyshare",
				start: true,
			},
			{
				run: async (args) => {
					calls.push(args);
					return { stdout: OK };
				},
			},
		);
		expect(result.ok).toBe(true);
		expect(calls[1]).toEqual([
			"task",
			"start",
			"--task-id",
			"65f2d",
			"--project-path",
			"/code/partyshare",
		]);
		expect(result.message).toContain("Started in partyshare");
	});

	it("says the card is filed even when starting it fails", async () => {
		// Reporting only the failure would read as if the demand had been lost.
		let call = 0;
		const result = await createKanbanTask(
			{
				description: "medir a suite",
				projectPath: "/code/partyshare",
				start: true,
			},
			{
				run: async () => {
					call += 1;
					if (call === 1) {
						return { stdout: OK };
					}
					throw Object.assign(new Error("boom"), { stderr: "boom" });
				},
			},
		);
		expect(result.ok).toBe(false);
		expect(result.taskId).toBe("65f2d");
		expect(result.message).toContain("card 65f2d");
		expect(result.message).toContain("could not start");
	});

	it("names the workspace and labels the id, so the reply is not a bare number", () => {
		// "Added to backlog as 12854" read as a formatting bug to the person who got it.
		return createKanbanTask(
			{ description: "confirmar o diretorio", projectPath: "/code/kanban" },
			{ run: async () => ({ stdout: OK }) },
		).then((result) => {
			expect(result.message).toBe(
				"Added to the kanban backlog: confirmar o diretorio (card 65f2d)",
			);
		});
	});
});

describe("buildBrainstormPrompt", () => {
	it("tells the agent to interview first and file afterwards", () => {
		const prompt = buildBrainstormPrompt({
			description: "melhorar o aceite",
			projectPath: "/code/partyshare",
			start: false,
		});
		expect(prompt).toContain("Do not file the card until the person confirms");
		expect(prompt).toContain("melhorar o aceite");
		// The first version let the agent go exploring and fall silent while the person waited.
		expect(prompt).toContain("Ask your first question in this very reply");
		expect(prompt).toContain("Do not dispatch sub-agents");
		expect(prompt).toContain(
			"kanban task create --project-path /code/partyshare",
		);
		expect(prompt).not.toContain("kanban task start");
	});

	it("adds the start step only when asked for", () => {
		const prompt = buildBrainstormPrompt({
			description: "melhorar o aceite",
			projectPath: "/code/partyshare",
			start: true,
		});
		expect(prompt).toContain("kanban task start");
	});
});

describe("parseTaskCommand with value flags", () => {
	it("reads tags, category and priority from the front of the line", () => {
		expect(
			parseTaskCommand([
				"--tags",
				"infra,docs",
				"--category",
				"bug",
				"--priority",
				"high",
				"consertar",
				"o",
				"aceite",
			]),
		).toEqual({
			start: false,
			brainstorm: false,
			tags: "infra,docs",
			category: "bug",
			priority: "high",
			description: "consertar o aceite",
		});
	});

	it("mixes value flags with the boolean ones in any order", () => {
		const parsed = parseTaskCommand([
			"--priority",
			"low",
			"--start",
			"medir",
			"a",
			"suite",
		]);
		expect(parsed.start).toBe(true);
		expect(parsed.priority).toBe("low");
		expect(parsed.description).toBe("medir a suite");
	});

	it("does not eat the demand when a value flag has no value", () => {
		// `--tags --start fix it` means the tags flag was a typo; swallowing "--start" as its
		// value would silently drop a flag the person did mean.
		const parsed = parseTaskCommand(["--tags", "--start", "fix", "it"]);
		expect(parsed.tags).toBeUndefined();
		expect(parsed.start).toBe(true);
		expect(parsed.description).toBe("fix it");
	});

	it("leaves a value flag alone once the demand has started", () => {
		const parsed = parseTaskCommand(["fix", "the", "--priority", "flag"]);
		expect(parsed.priority).toBeUndefined();
		expect(parsed.description).toBe("fix the --priority flag");
	});

	it("carries a trailing flag with nothing after it without crashing", () => {
		expect(parseTaskCommand(["--tags"]).description).toBe("");
	});
});

describe("buildKanbanCreateArgs with attributes", () => {
	it("passes them through as written, letting Kanban judge them", () => {
		// Validating a tag or a priority twice is how the two sides drift apart.
		const args = buildKanbanCreateArgs({
			description: "work",
			projectPath: "/code/app",
			tags: "infra,docs",
			category: "bug",
			priority: "high",
		});
		expect(args).toContain("--tags");
		expect(args).toContain("infra,docs");
		expect(args).toContain("--priority");
		expect(args).toContain("high");
	});

	it("leaves the flags out when nothing was given", () => {
		const args = buildKanbanCreateArgs({
			description: "work",
			projectPath: "/code/app",
		});
		expect(args).not.toContain("--tags");
		expect(args).not.toContain("--priority");
	});
});
