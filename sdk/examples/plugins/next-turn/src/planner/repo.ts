import {
	existsSync,
	readdirSync,
	readFileSync,
	type Stats,
	statSync,
} from "node:fs";
import { join } from "node:path";
import type { Facts } from "../types";
import { redactSecrets } from "./redact";

/**
 * Repository conventions, ported from #15095's `context/sources/repo.ts`: the
 * commands this repository says to run, so a Verify or Commit suggestion
 * names the real one ("Run `bun run check`") instead of "run the tests".
 * Workspace files only, read synchronously and cached by modification time:
 *
 * - `package.json` scripts named like test, check, lint, typecheck, build;
 * - the "Before you push" and "Commands" sections of `AGENTS.md`,
 *   `CLAUDE.md` and `.clinerules` (a file or a folder of them);
 * - `Makefile` targets of the same names.
 */

const REPO_COMMANDS_MAX = 8;
const REPO_FILE_MAX_BYTES = 262_144;
/** Reads are synchronous, so the folder is capped to keep the worker's block short. */
const RULES_FOLDER_MAX_FILES = 16;
const PACKAGE_FILE = "package.json";
const MAKEFILE = "Makefile";
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", ".clinerules"] as const;
/** The runner `package.json` scripts go through, by the first lockfile found beside it. */
const LOCKFILE_RUNNERS = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
] as const;

const VERIFY_NAME = /^(?:test|check|lint|typecheck|build)(?:[:_-][\w:-]+)?$/;
const SECTION_HEADING = /^(#{1,6})\s+(.*)$/;
const COMMAND_SECTIONS = /^(?:before you push|commands)\b/i;
const FENCE = /^\s*(```|~~~)/;
const MAKE_TARGET = /^([A-Za-z][\w-]*)\s*:(?!=)/;

type RepoConventions = {
	runner: string;
	scripts: string[];
	documented: string[];
	makeTargets: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function verifyScripts(packageJson: string): string[] {
	try {
		const parsed: unknown = JSON.parse(packageJson);
		if (!isRecord(parsed) || !isRecord(parsed.scripts)) return [];
		return Object.keys(parsed.scripts)
			.filter((name) => VERIFY_NAME.test(name))
			.sort()
			.slice(0, REPO_COMMANDS_MAX);
	} catch {
		return [];
	}
}

/** Shell lines from fenced blocks under a "Before you push" or "Commands" heading; trailing `#` comments are dropped. */
export function documentedCommands(markdown: string): string[] {
	const commands: string[] = [];
	let inSection = false;
	let sectionLevel = 0;
	let inFence = false;
	for (const raw of markdown.split(/\r?\n/)) {
		if (FENCE.test(raw)) {
			inFence = !inFence;
			continue;
		}
		const heading = inFence ? null : SECTION_HEADING.exec(raw);
		if (heading) {
			const level = heading[1].length;
			if (COMMAND_SECTIONS.test(heading[2])) {
				inSection = true;
				sectionLevel = level;
			} else if (level <= sectionLevel) inSection = false;
			continue;
		}
		if (!inSection || !inFence) continue;
		const command = raw.replace(/\s+#\s.*$/, "").trim();
		if (command && !command.startsWith("#") && !commands.includes(command))
			commands.push(command);
	}
	return commands.slice(0, REPO_COMMANDS_MAX);
}

export function makeTargets(makefile: string): string[] {
	const targets = new Set<string>();
	for (const line of makefile.split(/\r?\n/)) {
		const match = MAKE_TARGET.exec(line);
		if (match?.[1] && VERIFY_NAME.test(match[1])) targets.add(match[1]);
	}
	return [...targets].sort().slice(0, REPO_COMMANDS_MAX);
}

function repoFacts(conventions: RepoConventions): Facts {
	const lines: string[] = [];
	for (const script of conventions.scripts)
		lines.push(`Script: \`${conventions.runner} run ${script}\``);
	for (const target of conventions.makeTargets)
		lines.push(`Make target: \`make ${target}\``);
	for (const command of conventions.documented)
		lines.push(`Documented: \`${command}\``);
	return { heading: "This repository's commands", lines };
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

/** Reads each file once per modification; files over the size cap are skipped. A read that fails for any other reason is `"unknown"`. */
export class RepoReader {
	private readonly cache = new Map<
		string,
		{ mtimeMs: number; value: string }
	>();

	read(path: string): string | undefined | "unknown" {
		try {
			return this.readStat(path, statSync(path));
		} catch (error) {
			return isMissing(error) ? undefined : "unknown";
		}
	}

	/** A file, or each Markdown file in a folder of that name (`.clinerules/`). */
	readAll(path: string): string[] | "unknown" {
		try {
			const stat = statSync(path);
			if (!stat.isDirectory()) {
				const text = this.readStat(path, stat);
				if (text === "unknown") return "unknown";
				return text === undefined ? [] : [text];
			}
			const texts: string[] = [];
			for (const name of readdirSync(path)
				.filter((entry) => entry.endsWith(".md"))
				.sort()
				.slice(0, RULES_FOLDER_MAX_FILES)) {
				const text = this.read(join(path, name));
				if (text === "unknown") return "unknown";
				if (text !== undefined) texts.push(text);
			}
			return texts;
		} catch (error) {
			return isMissing(error) ? [] : "unknown";
		}
	}

	private readStat(path: string, stat: Stats): string | undefined | "unknown" {
		if (!stat.isFile() || stat.size > REPO_FILE_MAX_BYTES) return undefined;
		const hit = this.cache.get(path);
		if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value;
		try {
			const value = readFileSync(path, "utf8");
			this.cache.set(path, { mtimeMs: stat.mtimeMs, value });
			return value;
		} catch (error) {
			return isMissing(error) ? undefined : "unknown";
		}
	}
}

/** Everything the repository says to run. `"unknown"` when a command file exists but cannot be read. Undefined when none of the files exist or none names a command. */
export function readRepoFacts(
	workspaceRoot: string,
	reader: RepoReader,
): Facts | "unknown" | undefined {
	const at = (name: string) => join(workspaceRoot, name);
	if (
		![PACKAGE_FILE, MAKEFILE, ...INSTRUCTION_FILES].some((name) =>
			existsSync(at(name)),
		)
	)
		return undefined;
	const documented: string[] = [];
	for (const name of INSTRUCTION_FILES) {
		const texts = reader.readAll(at(name));
		if (texts === "unknown") return "unknown";
		for (const command of texts.flatMap(documentedCommands)) {
			if (!documented.includes(command)) documented.push(command);
		}
	}
	const packageText = reader.read(at(PACKAGE_FILE));
	if (packageText === "unknown") return "unknown";
	const makefile = reader.read(at(MAKEFILE));
	if (makefile === "unknown") return "unknown";
	const facts = repoFacts({
		runner:
			LOCKFILE_RUNNERS.find(([lockfile]) => existsSync(at(lockfile)))?.[1] ??
			"npm",
		scripts: verifyScripts(packageText ?? ""),
		documented: documented.slice(0, REPO_COMMANDS_MAX).map(redactSecrets),
		makeTargets: makeTargets(makefile ?? ""),
	});
	return facts.lines.length > 0 ? facts : undefined;
}
