/**
 * A pull request review's checkout, wherever a session is opened in it: the
 * pull request's author wrote every file there. A session whose working
 * directory is in it (Factory's reviewers, or a client's
 * session.create/restore) loads no rules, skills, workflows, hooks, plugins
 * or agent definitions from it; spawns no agents or teams; gets no
 * connector tools, checkpoints or provider-side tools; and its `read_files`
 * and `search_codebase` reach only files inside it, never its `.git`. Its
 * other tools, and MCP servers from the user's own settings, are whatever
 * the session was given: a client's session keeps its own tool policy.
 */
import { readFileSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { createSearchExecutor } from "../extensions/tools/executors/search";
import type {
	FileReadExecutor,
	SearchExecutor,
} from "../extensions/tools/types";

/**
 * The review checkout `dir` is in, or undefined: the nearest enclosing
 * `repo` folder whose Factory manifest beside it (`workspace.json`, written
 * outside the checkout) records a pull request review.
 */
export function factoryReviewCheckoutRoot(
	dir: string | undefined,
): string | undefined {
	if (!dir) return undefined;
	let current: string;
	try {
		current = realpathSync.native(dir);
	} catch {
		current = path.resolve(dir);
	}
	for (;;) {
		if (path.basename(current) === "repo") {
			try {
				const manifest = JSON.parse(
					readFileSync(
						path.join(path.dirname(current), "workspace.json"),
						"utf8",
					),
				) as { baseSource?: unknown };
				if (manifest.baseSource === "pull_request") return current;
			} catch {
				// Not a Factory workspace.
			}
		}
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * `read`, refusing any file whose real path (symbolic links resolved) is
 * outside `root` or in its `.git`.
 */
export function confineFactoryReviewFileReads(
	read: FileReadExecutor,
	root: string,
): FileReadExecutor {
	return async (request, context, cwd) => {
		if (request.path.startsWith("cline://")) return read(request, context, cwd);
		const real = await insideCheckout(
			root,
			path.resolve(cwd ?? root, request.path),
			`Cannot read ${request.path}: it does not exist or is outside the pull request's checkout.`,
		);
		return read({ ...request, path: real }, context, cwd);
	};
}

/**
 * `search_codebase` for a review checkout: ripgrep from a working directory
 * inside `root`, never following symbolic links (its default) and never
 * into `.git`, whatever the checkout's own ignore files say.
 */
export function factoryReviewSearch(root: string): SearchExecutor {
	const search = createSearchExecutor({ neverSearch: [".git"] });
	return async (query, cwd, context) =>
		search(
			query,
			await insideCheckout(
				root,
				cwd,
				"Cannot search here: it is outside the pull request's checkout.",
			),
			context,
		);
}

/** `target`'s real path, if it is inside `root` and not in its `.git`. */
async function insideCheckout(
	root: string,
	target: string,
	refusal: string,
): Promise<string> {
	const [real, top] = await Promise.all([
		realpath(target),
		realpath(root),
	]).catch(() => {
		throw new Error(refusal);
	});
	const [first] = path.relative(top, real).split(path.sep);
	if (first === ".." || first === ".git" || path.isAbsolute(first ?? ""))
		throw new Error(refusal);
	return real;
}
