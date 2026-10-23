/**
 * Keep-Changes-In-Project Extension
 *
 * `beforeTool` hook that refuses editor and apply_patch writes outside the
 * project while the "Only allow edits in project directory" setting is on. Commands
 * are contained separately by the project sandbox in the shell executor; this
 * covers the file tools, including host replacements like the VS Code diff
 * editor, which run in-process rather than through a shell.
 */

import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import type {
	AgentBeforeToolContext,
	AgentBeforeToolResult,
	AgentExtension,
} from "@cline/shared";
import { isKeepChangesInProjectEnabledGlobally } from "../../services/global-settings";
import { DefaultToolNames } from "./constants";
import { listPatchTargets } from "./executors/apply-patch";
import { PROJECT_SANDBOX_SETTING_LABEL } from "./executors/project-sandbox";

export const KEEP_CHANGES_IN_PROJECT_EXTENSION_NAME =
	"core.keep-changes-in-project";

function editTargets(toolName: string, input: unknown): string[] {
	if (toolName === DefaultToolNames.EDITOR) {
		const path = (input as { path?: unknown } | undefined)?.path;
		return typeof path === "string" ? [path] : [];
	}
	if (toolName === DefaultToolNames.APPLY_PATCH) {
		const patch =
			typeof input === "string"
				? input
				: (input as { input?: unknown } | undefined)?.input;
		return typeof patch === "string" ? listPatchTargets(patch) : [];
	}
	return [];
}

/**
 * Resolves symlinks in the longest existing prefix of `path`, so a link inside
 * the project that points elsewhere is judged by where writes actually land.
 */
function realPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		const parent = dirname(path);
		return parent === path ? path : join(realPath(parent), basename(path));
	}
}

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function createKeepChangesInProjectExtension(options: {
	cwd: string;
	workspaceRoot?: string;
}): AgentExtension {
	const allowedRoots = [
		options.cwd,
		options.workspaceRoot,
		tmpdir(),
		process.platform === "win32" ? undefined : "/tmp",
	].filter((root): root is string => Boolean(root));

	const beforeTool = (
		context: AgentBeforeToolContext,
	): AgentBeforeToolResult | undefined => {
		if (!isKeepChangesInProjectEnabledGlobally()) {
			return undefined;
		}
		const roots = allowedRoots.map(realPath);
		const outside = editTargets(context.tool.name, context.input).find(
			(path) => {
				const target = realPath(resolve(options.cwd, path));
				return !roots.some((root) => isInside(root, target));
			},
		);
		if (!outside) {
			return undefined;
		}
		return {
			skip: true,
			reason: `This edit tried to change ${outside}, which is outside your project. To allow that, the user can turn off "${PROJECT_SANDBOX_SETTING_LABEL}" in Settings.`,
		};
	};

	return {
		name: KEEP_CHANGES_IN_PROJECT_EXTENSION_NAME,
		manifest: {
			capabilities: ["hooks"],
		},
		hooks: {
			beforeTool,
		},
	};
}
