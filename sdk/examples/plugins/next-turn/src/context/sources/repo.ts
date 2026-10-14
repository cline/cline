import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	REPO_COMMANDS_MAX,
	REPO_FILE_MAX_BYTES,
	REPO_INSTRUCTION_FILES,
	REPO_LOCKFILE_RUNNERS,
	REPO_MAKEFILE,
	REPO_PACKAGE_FILE,
} from "../../config";
import { redactSecrets } from "../redact";
import type { ContextSource, Facts, SourceEnv, SourceState } from "../source";

/**
 * Repository conventions: the commands this repository says to run,
 * so Verify and Commit suggestions name the real one ("Run `bun run check`")
 * instead of "run the tests". Workspace files only, read synchronously within
 * T1's budget and cached by modification time:
 *
 * - `package.json` scripts named like test, check, lint, typecheck, build;
 * - the "Before you push" and "Commands" sections of `AGENTS.md`,
 *   `CLAUDE.md` and `.clinerules` (a file or a folder of them);
 * - `Makefile` targets of the same names.
 */

export const VERIFY_NAME =
	/^(?:test|check|lint|typecheck|build)(?:[:_-][\w:-]+)?$/;
const SECTION_HEADING = /^#{1,6}\s+(.*)$/;
const COMMAND_SECTIONS = /^(?:before you push|commands)\b/i;
const FENCE = /^\s*(```|~~~)/;
const MAKE_TARGET = /^([A-Za-z][\w-]*)\s*:(?!=)/;

export type RepoConventions = {
	runner: string;
	scripts: string[];
	documented: string[];
	makeTargets: string[];
};

/** `bun`, `pnpm`, `yarn` or `npm`, from the lockfile beside `package.json`. */
export function packageRunner(files: ReadonlySet<string>): string {
	for (const [lockfile, runner] of REPO_LOCKFILE_RUNNERS)
		if (files.has(lockfile)) return runner;
	return "npm";
}

export function verifyScripts(packageJson: string): string[] {
	try {
		const parsed: unknown = JSON.parse(packageJson);
		const scripts =
			typeof parsed === "object" && parsed !== null
				? (parsed as { scripts?: unknown }).scripts
				: undefined;
		if (typeof scripts !== "object" || scripts === null) return [];
		return Object.keys(scripts)
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
			const level = raw.indexOf(" ");
			if (COMMAND_SECTIONS.test(heading[1] ?? "")) {
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

export function repoFacts(conventions: RepoConventions): Facts {
	const lines: string[] = [];
	for (const script of conventions.scripts)
		lines.push(`Script: \`${conventions.runner} run ${script}\``);
	for (const target of conventions.makeTargets)
		lines.push(`Make target: \`make ${target}\``);
	for (const command of conventions.documented)
		lines.push(`Documented: \`${command}\``);
	return { heading: "This repository's commands", lines };
}

export function repoTags(conventions: RepoConventions): string[] {
	return [
		...conventions.scripts.map((name) => `script:${name}`),
		...conventions.makeTargets.map((name) => `make:${name}`),
	];
}

type Cached<T> = { mtimeMs: number; value: T };

/** Reads each file once per modification; files over the size cap are skipped. */
export class RepoReader {
	private readonly cache = new Map<string, Cached<string | undefined>>();

	read(path: string): string | undefined {
		try {
			const stat = statSync(path);
			if (!stat.isFile() || stat.size > REPO_FILE_MAX_BYTES) return undefined;
			const hit = this.cache.get(path);
			if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value;
			const value = readFileSync(path, "utf8");
			this.cache.set(path, { mtimeMs: stat.mtimeMs, value });
			return value;
		} catch {
			return undefined;
		}
	}

	/** A file, or each Markdown file in a folder of that name (`.clinerules/`). */
	readAll(path: string): string[] {
		try {
			if (!statSync(path).isDirectory())
				return [this.read(path)].filter(
					(text): text is string => text !== undefined,
				);
			return readdirSync(path)
				.filter((name) => name.endsWith(".md"))
				.sort()
				.map((name) => this.read(join(path, name)))
				.filter((text): text is string => text !== undefined);
		} catch {
			return [];
		}
	}
}

/** Everything the repository says to run; undefined when none of its files exist. */
export function readConventions(
	workspaceRoot: string,
	reader: RepoReader = new RepoReader(),
): RepoConventions | undefined {
	const at = (name: string) => join(workspaceRoot, name);
	const instructionNames: readonly string[] = REPO_INSTRUCTION_FILES;
	const present = [
		REPO_PACKAGE_FILE,
		REPO_MAKEFILE,
		...instructionNames,
	].filter((name) => existsSync(at(name)));
	if (present.length === 0) return undefined;
	const lockfiles = new Set(
		REPO_LOCKFILE_RUNNERS.map(([lockfile]) => lockfile).filter((name) =>
			existsSync(at(name)),
		),
	);
	const documented: string[] = [];
	for (const name of instructionNames) {
		for (const text of reader.readAll(at(name))) {
			for (const command of documentedCommands(text))
				if (!documented.includes(command)) documented.push(command);
		}
	}
	return {
		runner: packageRunner(lockfiles),
		scripts: verifyScripts(reader.read(at(REPO_PACKAGE_FILE)) ?? ""),
		documented: documented.slice(0, REPO_COMMANDS_MAX).map(redactSecrets),
		makeTargets: makeTargets(reader.read(at(REPO_MAKEFILE)) ?? ""),
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
