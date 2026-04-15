import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveWorkspaceRoot } from "./helpers";

export type ChatCommandState = {
	enableTools: boolean;
	autoApproveTools: boolean;
	cwd: string;
	workspaceRoot: string;
};

export type ChatCommandContext = {
	enabled: boolean;
	host?: ChatCommandHost;
	getState: () => Promise<ChatCommandState> | ChatCommandState;
	setState: (next: ChatCommandState) => Promise<void> | void;
	reply: (text: string) => Promise<void> | void;
	reset?: () => Promise<void> | void;
	abort?: () => Promise<void> | void;
	stop?: () => Promise<void> | void;
	describe?: () => Promise<string> | string;
	schedule?: {
		create?: (input: {
			name: string;
			cronPattern: string;
			prompt: string;
		}) => Promise<string> | string;
		list?: () => Promise<string> | string;
		delete?: (scheduleId: string) => Promise<string> | string;
		trigger?: (scheduleId: string) => Promise<string> | string;
	};
};

type ParsedChatCommand = {
	input: string;
	trimmed: string;
	command: string;
	args: string[];
	state: ChatCommandState;
};

export type ChatCommandDefinition = {
	names: string[];
	isAvailable?: (context: ChatCommandContext) => boolean;
	run: (
		parsed: ParsedChatCommand,
		context: ChatCommandContext,
	) => Promise<void> | void;
};

export class ChatCommandHost {
	private readonly definitions: ChatCommandDefinition[];

	constructor(definitions: ChatCommandDefinition[] = []) {
		this.definitions = [...definitions];
	}

	register(
		_kind: "command",
		definition: ChatCommandDefinition,
	): ChatCommandHost {
		this.definitions.push(definition);
		return this;
	}

	getDefinitions(): readonly ChatCommandDefinition[] {
		return this.definitions;
	}

	clone(): ChatCommandHost {
		return new ChatCommandHost(this.definitions);
	}

	async handle(input: string, context: ChatCommandContext): Promise<boolean> {
		if (!context.enabled) {
			return false;
		}

		const trimmed = input.trim();
		if (!trimmed.startsWith("/")) {
			return false;
		}

		const [commandRaw, ...args] = trimmed.split(/\s+/);
		const parsed: ParsedChatCommand = {
			input,
			trimmed,
			command: commandRaw.toLowerCase(),
			args,
			state: await context.getState(),
		};
		const matched = this.definitions.find((definition) =>
			definition.names.includes(parsed.command),
		);
		if (!matched) {
			return false;
		}
		if (matched.isAvailable && !matched.isAvailable(context)) {
			return false;
		}
		await matched.run(parsed, context);
		return true;
	}
}

function tokenizeArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaping = false;
	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) {
		tokens.push(current);
	}
	return tokens;
}

function parseFlagValues(tokens: string[]): {
	positionals: string[];
	flags: Record<string, string>;
} {
	const positionals: string[] = [];
	const flags: Record<string, string> = {};
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}
		const key = token.slice(2).trim().toLowerCase();
		const value = tokens[index + 1];
		if (!key || !value || value.startsWith("--")) {
			flags[key] = "";
			continue;
		}
		flags[key] = value;
		index += 1;
	}
	return { positionals, flags };
}

function scheduleUsage(): string {
	return [
		"Usage:",
		'/schedule create "<name>" --cron "<pattern>" --prompt "<text>"',
		"/schedule list",
		"/schedule trigger <schedule-id>",
		"/schedule delete <schedule-id>",
	].join("\n");
}

function parseBooleanValue(
	value: string | undefined,
	current: boolean,
): boolean | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	if (normalized === "on" || normalized === "true" || normalized === "1") {
		return true;
	}
	if (normalized === "off" || normalized === "false" || normalized === "0") {
		return false;
	}
	if (normalized === "toggle") {
		return !current;
	}
	return undefined;
}

function usage(text: string): string {
	return `Usage: ${text}`;
}

export function createChatCommandHost(): ChatCommandHost {
	return new ChatCommandHost();
}

function createDefaultChatCommandHost(): ChatCommandHost {
	return createChatCommandHost()
		.register("command", {
			names: ["/clear", "/new"],
			isAvailable: (context) => typeof context.reset === "function",
			run: async (_parsed, context) => {
				await context.reset?.();
				await context.reply("Started a fresh session.");
			},
		})
		.register("command", {
			names: ["/abort"],
			isAvailable: (context) => typeof context.abort === "function",
			run: async (_parsed, context) => {
				await context.abort?.();
			},
		})
		.register("command", {
			names: ["/exit"],
			isAvailable: (context) => typeof context.stop === "function",
			run: async (_parsed, context) => {
				await context.reply("Stopping session.");
				await context.stop?.();
			},
		})
		.register("command", {
			names: ["/whereami"],
			isAvailable: (context) => typeof context.describe === "function",
			run: async (_parsed, context) => {
				const description = await context.describe?.();
				if (description) {
					await context.reply(description);
				}
			},
		})
		.register("command", {
			names: ["/tools"],
			run: async ({ args, state }, context) => {
				const resolved = parseBooleanValue(args[0], state.enableTools);
				if (args[0] && resolved === undefined) {
					await context.reply(usage("/tools [on|off|toggle]"));
					return;
				}
				if (resolved === undefined) {
					await context.reply(`tools=${state.enableTools ? "on" : "off"}`);
					return;
				}
				await context.setState({ ...state, enableTools: resolved });
				await context.reply(`tools=${resolved ? "on" : "off"}`);
			},
		})
		.register("command", {
			names: ["/yolo"],
			run: async ({ args, state }, context) => {
				const resolved = parseBooleanValue(args[0], state.autoApproveTools);
				if (args[0] && resolved === undefined) {
					await context.reply(usage("/yolo [on|off|toggle]"));
					return;
				}
				if (resolved === undefined) {
					await context.reply(`yolo=${state.autoApproveTools ? "on" : "off"}`);
					return;
				}
				await context.setState({ ...state, autoApproveTools: resolved });
				await context.reply(`yolo=${resolved ? "on" : "off"}`);
			},
		})
		.register("command", {
			names: ["/cwd"],
			run: async ({ args, state }, context) => {
				const rawPath = args.join(" ").trim();
				if (!rawPath) {
					await context.reply(
						`cwd=${state.cwd}\nworkspaceRoot=${state.workspaceRoot}`,
					);
					return;
				}
				const nextCwd = resolve(state.cwd, rawPath);
				const fileStat = await stat(nextCwd).catch(() => undefined);
				if (!fileStat?.isDirectory()) {
					await context.reply(`invalid directory: ${nextCwd}`);
					return;
				}
				const workspaceRoot = resolveWorkspaceRoot(nextCwd);
				await context.setState({
					...state,
					cwd: nextCwd,
					workspaceRoot,
				});
				await context.reply(`cwd=${nextCwd}\nworkspaceRoot=${workspaceRoot}`);
			},
		})
		.register("command", {
			names: ["/team"],
			run: async ({ args }, context) => {
				const taskBody = args.join(" ").trim();
				if (!taskBody) {
					await context.reply(
						"Usage: /team <task description>\nStarts a team of agents for the given task.",
					);
					return;
				}
				// In the default host the /team command only shows usage.
				// The interactive runtime handles input transformation and
				// session-level enableTeams toggling before this host runs.
				await context.reply(
					"The /team command must be entered directly as a prompt, not via a chat command.",
				);
			},
		})
		.register("command", {
			names: ["/schedule"],
			run: async ({ args }, context) => {
				if (!context.schedule) {
					await context.reply("Scheduling is not available in this chat.");
					return;
				}
				const subcommand = args[0]?.trim().toLowerCase();
				if (!subcommand || subcommand === "help") {
					await context.reply(scheduleUsage());
					return;
				}
				if (subcommand === "list") {
					if (!context.schedule.list) {
						await context.reply("Schedule listing is not available here.");
						return;
					}
					await context.reply(await context.schedule.list());
					return;
				}
				if (subcommand === "trigger") {
					const scheduleId = args[1]?.trim();
					if (!scheduleId) {
						await context.reply(usage("/schedule trigger <schedule-id>"));
						return;
					}
					if (!context.schedule.trigger) {
						await context.reply("Schedule triggering is not available here.");
						return;
					}
					await context.reply(await context.schedule.trigger(scheduleId));
					return;
				}
				if (subcommand === "delete") {
					const scheduleId = args[1]?.trim();
					if (!scheduleId) {
						await context.reply(usage("/schedule delete <schedule-id>"));
						return;
					}
					if (!context.schedule.delete) {
						await context.reply("Schedule deletion is not available here.");
						return;
					}
					await context.reply(await context.schedule.delete(scheduleId));
					return;
				}
				if (subcommand === "create") {
					if (!context.schedule.create) {
						await context.reply("Schedule creation is not available here.");
						return;
					}
					const parsed = parseFlagValues(tokenizeArgs(args.slice(1).join(" ")));
					const name =
						parsed.positionals.join(" ").trim() || parsed.flags.name?.trim();
					const cronPattern = parsed.flags.cron?.trim();
					const prompt = parsed.flags.prompt?.trim();
					if (!name || !cronPattern || !prompt) {
						await context.reply(scheduleUsage());
						return;
					}
					await context.reply(
						await context.schedule.create({ name, cronPattern, prompt }),
					);
					return;
				}
				await context.reply(scheduleUsage());
			},
		});
}

export const chatCommandHost = createDefaultChatCommandHost();

export async function maybeHandleChatCommand(
	input: string,
	context: ChatCommandContext,
): Promise<boolean> {
	return (context.host ?? chatCommandHost).handle(input, context);
}
