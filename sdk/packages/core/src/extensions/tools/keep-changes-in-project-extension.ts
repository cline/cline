/**
 * Keep-Changes-In-Project Extension
 *
 * `beforeTool` hook that refuses editor and apply_patch writes outside the
 * project while the "Only allow edits in project directory" setting is on. Commands
 * are contained separately by the project sandbox in the shell executor; this
 * covers the file tools, including host replacements like the VS Code diff
 * editor, which run in-process rather than through a shell.
 */

import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type {
	AgentBeforeToolContext,
	AgentBeforeToolResult,
	AgentExtension,
} from "@cline/shared";
import { isKeepChangesInProjectEnabledGlobally } from "../../services/global-settings";
import { DefaultToolNames } from "./constants";
import { PROJECT_SANDBOX_SETTING_LABEL } from "./executors/project-sandbox";

export const KEEP_CHANGES_IN_PROJECT_EXTENSION_NAME =
	"core.keep-changes-in-project";

const PATCH_TARGET_PATTERN =
	/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;

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
		if (typeof patch !== "string") {
			return [];
		}
		return [...patch.matchAll(PATCH_TARGET_PATTERN)].map((match) =>
			match[1].trim(),
		);
	}
	return [];
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
		const outside = editTargets(context.tool.name, context.input).find(
			(path) =>
				!allowedRoots.some((root) =>
					isInside(root, resolve(options.cwd, path)),
				),
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
