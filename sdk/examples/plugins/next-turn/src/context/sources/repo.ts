import {
	existsSync,
	readdirSync,
	readFileSync,
	type Stats,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { REPO_COMMANDS_MAX, REPO_FILE_MAX_BYTES } from "../../config";
import { isRecord } from "../../values";
import { redactSecrets } from "../redact";
import type { ContextSource, Facts, SourceEnv, SourceState } from "../source";

/**
 * Repository conventions: the commands this repository says to run,
 * so Verify and Commit suggestions name the real one ("Run `bun run check`")
 * instead of "run the tests". Workspace files only, read synchronously and
 * cached by modification time:
 *
 * - `package.json` scripts named like test, check, lint, typecheck, build;
 * - the "Before you push" and "Commands" sections of `AGENTS.md`,
 *   `CLAUDE.md` and `.clinerules` (a file or a folder of them);
 * - `Makefile` targets of the same names.
 */

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

function repoTags(conventions: RepoConventions): string[] {
	return [
		...conventions.scripts.map((name) => `script:${name}`),
		...conventions.makeTargets.map((name) => `make:${name}`),
	];
}

/** Reads each file once per modification; files over the size cap are skipped. */
export class RepoReader {
	private readonly cache = new Map<
		string,
		{ mtimeMs: number; value: string }
	>();

	read(path: string): string | undefined {
		try {
			return this.readStat(path, statSync(path));
		} catch {
			return undefined;
		}
	}

	/** A file, or each Markdown file in a folder of that name (`.clinerules/`). */
	readAll(path: string): string[] {
		try {
			const stat = statSync(path);
			if (!stat.isDirectory()) {
				const text = this.readStat(path, stat);
				return text === undefined ? [] : [text];
			}
			return readdirSync(path)
				.filter((name) => name.endsWith(".md"))
				.sort()
				.flatMap((name) => this.read(join(path, name)) ?? []);
		} catch {
			return [];
		}
	}

	private readStat(path: string, stat: Stats): string | undefined {
		if (!stat.isFile() || stat.size > REPO_FILE_MAX_BYTES) return undefined;
		const hit = this.cache.get(path);
		if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value;
		const value = readFileSync(path, "utf8");
		this.cache.set(path, { mtimeMs: stat.mtimeMs, value });
		return value;
	}
}

/** Everything the repository says to run; undefined when none of its files exist. */
export function readConventions(
	workspaceRoot: string,
	reader: RepoReader = new RepoReader(),
): RepoConventions | undefined {
	const at = (name: string) => join(workspaceRoot, name);
	if (
		![PACKAGE_FILE, MAKEFILE, ...INSTRUCTION_FILES].some((name) =>
			existsSync(at(name)),
		)
	)
		return undefined;
	const documented = [
		...new Set(
			INSTRUCTION_FILES.flatMap((name) =>
				reader.readAll(at(name)).flatMap(documentedCommands),
			),
		),
	];
	return {
		runner:
			LOCKFILE_RUNNERS.find(([lockfile]) => existsSync(at(lockfile)))?.[1] ??
			"npm",
		scripts: verifyScripts(reader.read(at(PACKAGE_FILE)) ?? ""),
		documented: documented.slice(0, REPO_COMMANDS_MAX).map(redactSecrets),
		makeTargets: makeTargets(reader.read(at(MAKEFILE)) ?? ""),
	};
}

export function repoSource(
	reader: RepoReader = new RepoReader(),
): ContextSource {
	const conventionsOf = (env: SourceEnv) =>
		env.workspaceRoot ? readConventions(env.workspaceRoot, reader) : undefined;
	return {
		id: "repo",
		tier: "T1",
		displayName: "This repository's commands",
		settingsToggle: "repo",
		probe: (env): SourceState => (conventionsOf(env) ? "present" : "absent"),
		capabilities: (env) => {
			const conventions = conventionsOf(env);
			return conventions ? repoTags(conventions) : [];
		},
		facts: (env) => {
			const conventions = conventionsOf(env);
			return conventions ? repoFacts(conventions) : "unknown";
		},
	};
}
