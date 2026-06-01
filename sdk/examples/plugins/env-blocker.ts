/**
 * Env Blocker Plugin Example
 *
 * A rule in AGENTS.md / .clinerules ("never read .env files") is a suggestion the
 * model can ignore. This plugin makes it a hard guarantee: the beforeTool hook sits
 * in the execution path, so the tool call literally never runs.
 *
 * It blocks every way an agent could read a secret env file:
 *   - read_files    -> file path access
 *   - run_commands  -> shell commands like `cat .env` or `source .env.production`
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

/** True if a shell command reads a secret env file (cat .env, source ./.env, etc.). */
function commandReadsEnv(command: string): boolean {
	const tokens = command.match(/[\w./-]*\.env[\w.-]*/gi) ?? [];
	return tokens.some(isEnvFile);
}

/** Pull every file path out of a read_files tool input, across its many accepted shapes. */
function extractFilePaths(input: unknown): string[] {
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

/** Pull every shell command out of a run_commands input (string | array | { command | commands | cmd }). */
function extractShellCommands(input: unknown): string[] {
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
					blocked = extractFilePaths(input).find(isEnvFile);
					break;
				case "run_commands":
					blocked = extractShellCommands(input).find(commandReadsEnv);
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
