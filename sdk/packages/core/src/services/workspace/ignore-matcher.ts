/**
 * Workspace Ignore Matcher
 *
 * Parses .gitignore files -- including nested copies in subdirectories --
 * and exposes a single isIgnored() check that every search/indexing code
 * path can share, instead of each path reimplementing (or forgetting to
 * implement) .gitignore handling.
 *
 * Fixes cline/cline#13384's core, verifiable bug: ripgrep only honors
 * .gitignore inside a git working tree by default, so search behaved
 * differently depending on whether the workspace happened to be a git
 * repo. The JS fallback walker had no .gitignore awareness at all -- only
 * a hardcoded directory exclusion list.
 *
 * NOTE ON SCOPE: an earlier version of this fix also added support for
 * .clineignore and .agentignore. Both were removed after review:
 *   - .clineignore is being deprecated by the Cline team specifically
 *     because file-exclusion-as-access-control creates a false sense of
 *     security (see docs.cline.bot/resources/deprecations) -- expanding
 *     reliance on it here would work against that direction.
 *   - .agentignore was never an actual supported Cline feature; the only
 *     reference to it was an unimplemented feature-request discussion.
 * This module intentionally covers .gitignore only.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

export interface IgnoreMatcher {
	isIgnored(relativePath: string): boolean;
}

interface DirRuleset {
	/** Posix-style relative dir this ruleset applies to ("" for the workspace root). */
	dir: string;
	ig: Ignore;
}

function toPosix(p: string): string {
	return p.split(path.sep).join("/");
}

/**
 * Builds an ignore matcher from a set of already-known relative file paths
 * (e.g. an unfiltered file listing). Deliberately takes a file list rather
 * than walking the disk itself, so both the ripgrep-based listing path and
 * the JS walker fallback can reuse one matcher built from whichever listing
 * they already produced -- no second directory walk needed just to find
 * .gitignore files.
 */
export async function buildIgnoreMatcher(
	cwd: string,
	knownRelativePaths: Iterable<string>,
): Promise<IgnoreMatcher> {
	const gitignoreDirs = new Set<string>([""]); // always check the workspace root

	for (const relPath of knownRelativePaths) {
		const posixPath = toPosix(relPath);
		const base = posixPath.slice(posixPath.lastIndexOf("/") + 1);
		if (base === ".gitignore") {
			const dir = posixPath.slice(0, posixPath.length - base.length - 1);
			gitignoreDirs.add(dir);
		}
	}

	const rulesets: DirRuleset[] = [];
	for (const dir of gitignoreDirs) {
		const filePath = path.join(cwd, dir, ".gitignore");
		try {
			const content = await readFile(filePath, "utf-8");
			const ig = ignore().add(content);
			rulesets.push({ dir, ig });
		} catch {
			// No .gitignore in this directory -- fine, they're optional per-directory.
		}
	}

	// Deliberately order-independent: a path is ignored if ANY applicable
	// directory's ruleset ignores it, full stop. This is not "deepest wins" --
	// it's a plain OR across levels, which is what correctly implements real
	// gitignore semantics: "it is not possible to re-include a file if a
	// parent directory of that file is excluded" (gitignore(5)). A deeper
	// .gitignore's own negation pattern can only undo an ignore pattern
	// *within that same directory's own .gitignore* (handled internally by
	// the `ignore` package's last-match-wins semantics) -- it can never
	// override a shallower directory's exclusion, because in real git a
	// directory-level exclusion means the directory's contents (including
	// any nested .gitignore files) are never even inspected.
	return {
		isIgnored(relativePath: string): boolean {
			const posixPath = toPosix(relativePath);
			for (const { dir, ig } of rulesets) {
				if (dir && posixPath !== dir && !posixPath.startsWith(`${dir}/`)) {
					continue;
				}
				const scoped = dir ? posixPath.slice(dir.length + 1) : posixPath;
				if (!scoped) continue;
				if (ig.ignores(scoped)) {
					return true;
				}
			}
			return false;
		},
	};
}
