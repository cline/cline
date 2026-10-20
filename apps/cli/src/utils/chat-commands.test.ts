import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
	createChatCommandHost,
	isCommandAddressedToBot,
	maybeHandleChatCommand,
	normalizeCommandName,
} from "./chat-commands";
import { createKanbanTask } from "./kanban-task";

vi.mock("./kanban-task", async () => {
	const real = await import("./kanban-task");
	return {
		...real,
		createKanbanTask: vi.fn(async () => ({
			ok: true,
			taskId: "65f2d",
			message:
				"Added to the partyshare backlog: Congelar a margem (card 65f2d)",
		})),
	};
});

describe("chat commands", () => {
	it("shows connector help for /help and /start", async () => {
		for (const { command, botUserName } of [
			{ command: "/help" },
			{ command: "/start" },
			{ command: "/help@clinebot", botUserName: "clinebot" },
			{ command: "/start@cline_bot", botUserName: "@cline_bot" },
		]) {
			const reply = vi.fn(async () => undefined);

			const handled = await maybeHandleChatCommand(command, {
				enabled: true,
				botUserName,
				getState: async () => ({
					enableTools: true,
					autoApproveTools: false,
					cwd: "/tmp",
					workspaceRoot: "/tmp",
				}),
				setState: async () => undefined,
				reply,
			});

			expect(handled).toBe(true);
			expect(reply).toHaveBeenCalledWith(
				expect.stringContaining("Cline connector commands:"),
			);
			expect(reply).toHaveBeenCalledWith(
				expect.stringContaining("Current state: tools=on, yolo=off"),
			);
			expect(reply).toHaveBeenCalledWith(
				expect.stringContaining(
					"/schedule create/list/trigger/delete - manage scheduled workflows",
				),
			);
			expect(reply).toHaveBeenCalledWith(
				expect.stringContaining(
					"When tools are on, I can inspect files, edit code, run commands/tests, and help prepare PRs.",
				),
			);
		}
	});

	it("does not handle bot-suffixed commands addressed to another bot", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/help@otherbot", {
			enabled: true,
			botUserName: "clinebot",
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(false);
		expect(reply).not.toHaveBeenCalled();
	});

	it("requires a bot suffix when requested", async () => {
		const reply = vi.fn(async () => undefined);
		const context = {
			enabled: true,
			botUserName: "clinebot",
			requireBotMention: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		};

		expect(await maybeHandleChatCommand("/help", context)).toBe(false);
		expect(reply).not.toHaveBeenCalled();

		expect(await maybeHandleChatCommand("/help@clinebot", context)).toBe(true);
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining("Cline connector commands:"),
		);
	});

	it("detects commands addressed to the configured bot", () => {
		expect(isCommandAddressedToBot("/new@clinebot", "clinebot")).toBe(true);
		expect(isCommandAddressedToBot("/new@cline_bot", "@cline_bot")).toBe(true);
		expect(isCommandAddressedToBot("/new@cline.bot", "cline.bot")).toBe(true);
		expect(isCommandAddressedToBot("/new@cline-bot", "cline-bot")).toBe(true);
		expect(isCommandAddressedToBot("/new", "clinebot")).toBe(false);
		expect(isCommandAddressedToBot("/new@otherbot", "clinebot")).toBe(false);
		expect(isCommandAddressedToBot("/new@clinebot", undefined)).toBe(false);
	});

	it("normalizes commands addressed to dotted and hyphenated bot names", () => {
		expect(normalizeCommandName("/new@cline.bot", "cline.bot")).toBe("/new");
		expect(normalizeCommandName("/new@cline-bot", "cline-bot")).toBe("/new");
	});

	it("leaves bot-suffixed commands unmatched without a known bot username", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/help@clinebot", {
			enabled: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(false);
		expect(reply).not.toHaveBeenCalled();
	});

	it("explains when tool controls are locked by startup", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/help", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
				toolsLocked: true,
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining(
				"Tool controls are locked because this connector was started with --no-tools.",
			),
		);
	});

	it("treats /new as a reset alias", async () => {
		const reset = vi.fn(async () => undefined);
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/new", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			reset,
		});

		expect(handled).toBe(true);
		expect(reset).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith("Started a fresh session.");
	});

	it("supports registering reusable commands on a host", async () => {
		const reply = vi.fn(async () => undefined);
		const host = createChatCommandHost().register("command", {
			names: ["/echo"],
			run: async ({ args }, context) => {
				await context.reply(args.join(" "));
			},
		});

		const handled = await host.handle("/echo hello world", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith("hello world");
	});

	it("shows usage for /team with no arguments", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/team", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith(
			"Usage: /team <task description>\nStarts a team of agents for the given task.",
		);
	});

	it("replies with unsupported message for /team with arguments in default host", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/team build a web app", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith(
			"The /team command must be entered directly as a prompt, not via a chat command.",
		);
	});

	it("runs /fork and replies with forked session ids", async () => {
		const reply = vi.fn(async () => undefined);
		const fork = vi.fn(async () => ({
			forkedFromSessionId: "sess_original",
			newSessionId: "sess_fork",
		}));

		const handled = await maybeHandleChatCommand("/fork", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			fork,
		});

		expect(handled).toBe(true);
		expect(fork).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith(
			"Forked session sess_original into new session sess_fork. This is now the active session. Use /history to switch sessions.",
		);
	});

	it("replies with failure message when fork returns undefined", async () => {
		const reply = vi.fn(async () => undefined);
		const fork = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/fork", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			fork,
		});

		expect(handled).toBe(true);
		expect(fork).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith(
			"Fork failed: could not read messages from the current session.",
		);
	});

	it("surfaces thrown error message when fork throws", async () => {
		const reply = vi.fn(async () => undefined);
		const fork = vi.fn(async () => {
			throw new Error("Cannot fork an empty session.");
		});

		const handled = await maybeHandleChatCommand("/fork", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			fork,
		});

		expect(handled).toBe(true);
		expect(fork).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith("Cannot fork an empty session.");
	});

	it("ignores /fork when fork callback is not provided", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/fork", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			// No fork callback, so the command should not be available.
		});

		// isAvailable returns false when fork is not defined, so the command
		// is not matched and the handler returns false.
		expect(handled).toBe(false);
		expect(reply).not.toHaveBeenCalled();
	});

	it("runs /abort without disconnecting", async () => {
		const abort = vi.fn(async () => undefined);
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/abort", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			abort,
		});

		expect(handled).toBe(true);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(reply).not.toHaveBeenCalled();
	});
});

describe("/task", () => {
	function context(
		reply: (text: string) => Promise<void>,
		cwd: string,
		workspaceRoot: string,
	) {
		return {
			enabled: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd,
				workspaceRoot,
			}),
			setState: async () => undefined,
			reply,
		};
	}

	it("creates the card against the conversation's repository, not its worktree", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		const handled = await maybeHandleChatCommand(
			"/task Congelar a margem no aceite",
			context(
				reply,
				"/home/me/.cline/worktrees/461e5/partyshare",
				"/code/partyshare",
			),
		);

		expect(handled).toBe(true);
		expect(createKanbanTask).toHaveBeenCalledWith({
			description: "Congelar a margem no aceite",
			projectPath: "/code/partyshare",
			start: false,
			source: undefined,
		});
		expect(reply).toHaveBeenCalledWith(
			"Added to the partyshare backlog: Congelar a margem (card 65f2d)",
		);
	});

	it("shows usage instead of creating an empty card", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		vi.mocked(createKanbanTask).mockClear();
		const handled = await maybeHandleChatCommand(
			"/task",
			context(reply, "/code/app", "/code/app"),
		);

		expect(handled).toBe(true);
		expect(createKanbanTask).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledWith(expect.stringContaining("Usage: /task"));
	});

	it("is listed in the help, or nobody would find it", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand(
			"/help",
			context(reply, "/code/app", "/code/app"),
		);
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining("/task [--start] [--brainstorm]"),
		);
	});

	it("hands the brainstorm to the agent instead of filing the card", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		const submitPrompt = vi.fn<(prompt: string) => Promise<void>>(
			async () => undefined,
		);
		vi.mocked(createKanbanTask).mockClear();

		const handled = await maybeHandleChatCommand(
			"/task --brainstorm melhorar o aceite",
			{
				...context(reply, "/code/partyshare", "/code/partyshare"),
				submitPrompt,
			},
		);

		expect(handled).toBe(true);
		expect(createKanbanTask).not.toHaveBeenCalled();
		expect(submitPrompt).toHaveBeenCalledWith(
			expect.stringContaining("Interview the person about it"),
		);
		expect(submitPrompt).toHaveBeenCalledWith(
			expect.stringContaining("melhorar o aceite"),
		);
	});

	it("says so plainly when the surface has no agent to brainstorm with", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		vi.mocked(createKanbanTask).mockClear();

		await maybeHandleChatCommand(
			"/task --brainstorm melhorar o aceite",
			context(reply, "/code/partyshare", "/code/partyshare"),
		);

		expect(createKanbanTask).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining("cannot brainstorm here"),
		);
	});

	it("asks for the card to be started when told to", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		vi.mocked(createKanbanTask).mockClear();

		await maybeHandleChatCommand(
			"/task --start medir a suite",
			context(reply, "/code/partyshare", "/code/partyshare"),
		);

		expect(createKanbanTask).toHaveBeenCalledWith({
			description: "medir a suite",
			projectPath: "/code/partyshare",
			start: true,
			source: undefined,
		});
	});
});

describe("where a card says it came from", () => {
	it("files the card with the surface that asked for it", async () => {
		// On a board one person works, who filed it says something; whose face it is does not.
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		vi.mocked(createKanbanTask).mockClear();

		await maybeHandleChatCommand("/task medir a suite", {
			enabled: true,
			transport: "telegram",
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/code/app",
				workspaceRoot: "/code/app",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(vi.mocked(createKanbanTask).mock.calls[0]?.[0]).toMatchObject({
			source: "telegram",
		});
	});
});

describe("/task marks the message instead of adding another", () => {
	function context(reply: (text: string) => Promise<void>) {
		return {
			enabled: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/code/app",
				workspaceRoot: "/code/app",
			}),
			setState: async () => undefined,
			reply,
		};
	}

	// The complaint that prompted this: "several messages arrive in sequence and they are not
	// very informative". A started card posts its own message and keeps it current, so the
	// command answering in words as well is one line of noise on top of it.
	it("reacts and stays silent when the card will announce itself", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		const react = vi.fn<(emoji: string) => Promise<void>>(
			async () => undefined,
		);
		vi.mocked(createKanbanTask).mockClear();

		await maybeHandleChatCommand("/task --start fix the thing", {
			...context(reply),
			react,
		});

		expect(react.mock.calls.map(([emoji]) => emoji)).toEqual(["👀", "✍", "👍"]);
		expect(reply).not.toHaveBeenCalled();
	});

	// A card parked in the backlog has nothing coming to announce it, so its id still has to
	// be said or it is lost.
	it("still says the card id when nothing will announce it", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		const react = vi.fn<(emoji: string) => Promise<void>>(
			async () => undefined,
		);
		vi.mocked(createKanbanTask).mockClear();

		await maybeHandleChatCommand("/task fix the thing", {
			...context(reply),
			react,
		});

		expect(reply).toHaveBeenCalledWith(expect.stringContaining("card"));
	});

	// A surface without reactions must not lose the confirmation along with them.
	it("answers in words when the surface has no reactions", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		vi.mocked(createKanbanTask).mockClear();

		await maybeHandleChatCommand("/task --start fix the thing", context(reply));

		expect(reply).not.toHaveBeenCalled();
	});
});

describe("/task with a picture", () => {
	// The defect: a screenshot captioned "/task desativar a mensagem de ativação" filed a card
	// from the caption alone, and the picture -- the clearest part of the demand -- was lost.
	function picture(failed = 0) {
		const dir = mkdtempSync(join(tmpdir(), "task-images-"));
		const path = join(dir, "image-1.jpg");
		writeFileSync(path, Buffer.from([1]));
		return {
			dir,
			path,
			saved: { dir, paths: failed ? [] : [path], failed, refused: 0 },
		};
	}

	function context(input: {
		reply: (text: string) => Promise<void>;
		images: () => Promise<{
			dir: string;
			paths: string[];
			failed: number;
			refused: number;
		}>;
		submitPrompt?: (prompt: string) => void;
	}) {
		return {
			enabled: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/code/kanban",
				workspaceRoot: "/code/kanban",
			}),
			setState: async () => undefined,
			reply: input.reply,
			images: input.images,
			submitPrompt: input.submitPrompt,
		};
	}

	it("files the pictures with the card, says so, then removes them", async () => {
		vi.mocked(createKanbanTask).mockClear();
		const { dir, path, saved } = picture();
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand(
			"/task desativar a mensagem de ativação",
			context({ reply, images: async () => saved }),
		);
		expect(vi.mocked(createKanbanTask).mock.calls[0]?.[0].images).toEqual([
			path,
		]);
		expect(reply).toHaveBeenCalledWith(
			"Added to the partyshare backlog: Congelar a margem (card 65f2d, 1 imagem)",
		);
		expect(existsSync(dir)).toBe(false);
	});

	it("keeps the pictures for --brainstorm, for the agent to attach", async () => {
		const { dir, path, saved } = picture();
		const submitPrompt = vi.fn<(prompt: string) => void>();
		await maybeHandleChatCommand(
			"/task --brainstorm desativar a mensagem",
			context({
				reply: async () => undefined,
				images: async () => saved,
				submitPrompt,
			}),
		);
		expect(submitPrompt.mock.calls[0]?.[0]).toContain(`--image ${path}`);
		expect(existsSync(dir)).toBe(true);
	});

	it("still files the card when the picture could not be downloaded", async () => {
		vi.mocked(createKanbanTask).mockClear();
		const { saved } = picture(1);
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand(
			"/task desativar a mensagem",
			context({ reply, images: async () => saved }),
		);
		expect(createKanbanTask).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith(
			"Added to the partyshare backlog: Congelar a margem (card 65f2d — a imagem não pôde ser baixada)",
		);
	});
});

describe("/chat", () => {
	function context(input: {
		reply: (text: string) => Promise<void>;
		submitPrompt?: (prompt: string) => void;
		images?: () => Promise<
			| {
					dir: string;
					paths: string[];
					failed: number;
					refused: number;
			  }
			| undefined
		>;
	}) {
		return {
			enabled: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/home/me/.cline/worktrees/461e5/partyshare",
				workspaceRoot: "/code/partyshare",
			}),
			setState: async () => undefined,
			reply: input.reply,
			submitPrompt: input.submitPrompt,
			images: input.images,
		};
	}

	it("hands the question to the agent and files no card", async () => {
		vi.mocked(createKanbanTask).mockClear();
		const submitPrompt = vi.fn<(prompt: string) => void>();
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);

		const handled = await maybeHandleChatCommand(
			"/chat o que muda se a fila for por tópico?",
			context({ reply, submitPrompt }),
		);

		expect(handled).toBe(true);
		expect(createKanbanTask).not.toHaveBeenCalled();
		const prompt = submitPrompt.mock.calls[0]?.[0] ?? "";
		expect(prompt).toContain("Projeto deste tópico: /code/partyshare.");
		expect(prompt).toContain("o que muda se a fila for por tópico?");
		expect(reply).not.toHaveBeenCalled();
	});

	it("keeps the line breaks of a question written over several lines", async () => {
		const submitPrompt = vi.fn<(prompt: string) => void>();
		await maybeHandleChatCommand(
			"/chat compare:\n- fila por tópico\n- fila global",
			context({ reply: async () => undefined, submitPrompt }),
		);
		expect(submitPrompt.mock.calls[0]?.[0]).toContain(
			"compare:\n- fila por tópico\n- fila global",
		);
	});

	it("passes the pictures sent with the question", async () => {
		const submitPrompt = vi.fn<(prompt: string) => void>();
		await maybeHandleChatCommand(
			"/chat o que é este erro?",
			context({
				reply: async () => undefined,
				submitPrompt,
				images: async () => ({
					dir: "/tmp/imgs",
					paths: ["/tmp/imgs/erro.png"],
					failed: 0,
					refused: 0,
				}),
			}),
		);
		expect(submitPrompt.mock.calls[0]?.[0]).toContain("- /tmp/imgs/erro.png");
	});

	it("shows usage when there is no question", async () => {
		const submitPrompt = vi.fn<(prompt: string) => void>();
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand("/chat", context({ reply, submitPrompt }));
		expect(submitPrompt).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledWith(
			"Usage: /chat <pergunta> - conversa aberta, sem criar card",
		);
	});

	it("refuses before saving pictures when the surface has no agent", async () => {
		const images = vi.fn(async () => undefined);
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand(
			"/chat o que é isto?",
			context({ reply, images }),
		);
		expect(images).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining("cannot chat here"),
		);
	});

	it("is listed in the help", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand("/help", context({ reply }));
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining("/chat <question>"),
		);
	});

	it("does not let a picture that failed to download vanish silently", async () => {
		const submitPrompt = vi.fn<(prompt: string) => void>();
		await maybeHandleChatCommand(
			"/chat o que é este erro?",
			context({
				reply: async () => undefined,
				submitPrompt,
				images: async () => ({
					dir: "/tmp/imgs",
					paths: [],
					failed: 1,
					refused: 1,
				}),
			}),
		);
		expect(submitPrompt.mock.calls[0]?.[0]).toContain(
			"2 imagens enviadas com a pergunta não puderam ser baixadas",
		);
	});
});
