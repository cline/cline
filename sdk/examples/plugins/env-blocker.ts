/**
 * Env Blocker Plugin Example
 *
 * A rule in AGENTS.md / .clinerules ("never read .env files") is a suggestion the
 * model can ignore. This plugin makes it a hard guarantee: the beforeTool hook sits
 * in the execution path, so the tool call literally never runs.
 *
 * It blocks every way an agent could reach a secret env file:
 *   - read_files / editor  -> file path access
 *   - run_commands         -> shell commands like `cat .env` or `source .env.production`
 *
 * Template files (.env.example, .env.sample, .env.template) stay readable.
 *
 * CLI usage:
 *   cline plugin install https://github.com/cline/cline/blob/main/sdk/examples/plugins/env-blocker.ts
 *   cline -i "Read the .env file and tell me the API keys"
 */

import { basename } from "node:path";
import type { AgentPlugin } from "@cline/core";

// .env.example / .env.sample / .env.template hold placeholders, not secrets.
const TEMPLATE = /\.env\.(example|sample|template)$/i;

/** True for .env, .env.local, .env.production, path/to/.env, etc. (but not templates). */
function isEnvFile(rawPath: string): boolean {
	const path = rawPath.trim().replace(/^['"]|['"]$/g, "");
	const name = basename(path);
	if (TEMPLATE.test(name)) {
		return false;
	}
	return /^\.env(\.|$)/i.test(name);
}

/** True if a shell command references a secret env file (cat .env, source ./.env, etc.). */
function commandTouchesEnv(command: string): boolean {
	const tokens = command.match(/[\w./-]*\.env[\w.-]*/gi) ?? [];
	return tokens.some(isEnvFile);
}

/** Collect every file path mentioned in a tool input, across its many accepted shapes. */
function collectPaths(input: unknown): string[] {
	const paths: string[] = [];
	const visit = (value: unknown): void => {
		if (typeof value === "string") {
			paths.push(value);
		} else if (Array.isArray(value)) {
			value.forEach(visit);
		} else if (value && typeof value === "object") {
			const record = value as Record<string, unknown>;
			if (typeof record.path === "string") {
				paths.push(record.path);
			}
			visit(record.files);
			visit(record.file_paths);
			visit(record.paths);
		}
	};
	visit(input);
	return paths;
}

/** Normalize run_commands input (string | array | { command | commands | cmd }) to a list. */
function collectCommands(input: unknown): string[] {
	if (typeof input === "string") {
		return [input];
	}
	if (Array.isArray(input)) {
		return input.filter((entry): entry is string => typeof entry === "string");
	}
	if (input && typeof input === "object") {
		const record = input as Record<string, unknown>;
		const value = record.command ?? record.commands ?? record.cmd;
		if (typeof value === "string") {
			return [value];
		}
		if (Array.isArray(value)) {
			return value.filter(
				(entry): entry is string => typeof entry === "string",
			);
		}
	}
	return [];
}

const plugin: AgentPlugin = {
	name: "env-blocker",
	manifest: {
		capabilities: ["hooks"],
	},

	hooks: {
		async beforeTool({ toolCall, input }) {
			let blocked: string | undefined;

			switch (toolCall.toolName) {
				case "read_files":
				case "editor":
					blocked = collectPaths(input).find(isEnvFile);
					break;
				case "run_commands":
					blocked = collectCommands(input).find(commandTouchesEnv);
					break;
			}

			if (!blocked) {
				return undefined;
			}

			console.error(`[env-blocker] blocked ${toolCall.toolName}: ${blocked}`);
			return {
				skip: true,
				reason: `Blocked ${toolCall.toolName}: reading environment secret files (${blocked}) is not permitted. Ask the user for any values you need.`,
			};
		},
	},
};

export { plugin };
export default plugin;
