/**
 * Workspace Ignore Matcher
 *
 * Parses .gitignore / .clineignore / .agentignore files -- including nested
 * copies in subdirectories -- and exposes a single isIgnored() check that
 * every search/indexing code path can share, instead of each path
 * reimplementing (or forgetting to implement) ignore-file handling.
 *
 * Fixes cline/cline#13384: search_codebase returns matches from directories
 * already excluded by workspace ignore files. Root causes were:
 *   - the ripgrep content-search path never read .clineignore/.agentignore
 *     at all, and only honored .gitignore when run inside a git working tree
 *   - the JS fallback walker filtered only against a hardcoded directory
 *     name list, with no ignore-file parsing whatsoever
 *
 * This module intentionally does NOT depend on rg's own gitignore handling,
 * so behavior no longer depends on whether the workspace happens to be a
 * git repo.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

const IGNORE_FILENAMES = [".gitignore", ".clineignore", ".agentignore"] as const;

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

export async function buildIgnoreMatcher(
 cwd: string,
 knownRelativePaths: Iterable<string>,
): Promise<IgnoreMatcher> {
 const ignoreFileDirs = new Set<string>([""]);

 for (const relPath of knownRelativePaths) {
  const posixPath = toPosix(relPath);
  const base = posixPath.slice(posixPath.lastIndexOf("/") + 1);
  if ((IGNORE_FILENAMES as readonly string[]).includes(base)) {
   const dir = posixPath.slice(0, posixPath.length - base.length - 1);
   ignoreFileDirs.add(dir);
  }
 }

 const rulesets: DirRuleset[] = [];
 for (const dir of ignoreFileDirs) {
  const ig = ignore();
  let anyLoaded = false;
  for (const filename of IGNORE_FILENAMES) {
   const filePath = path.join(cwd, dir, filename);
   try {
    const content = await readFile(filePath, "utf-8");
    ig.add(content);
    anyLoaded = true;
   } catch {
   }
  }
  if (anyLoaded) {
   rulesets.push({ dir, ig });
  }
 }

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
