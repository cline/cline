import * as p from "@clack/prompts";
import { isWorkspaceTrusted, trustWorkspace } from "@cline/shared/storage";

/**
 * Asks before Cline starts in a folder that is not on the allow list, since the
 * folder's rules, skills, hooks, and plugins load automatically. Resolves to
 * false when the user declines.
 */
export async function ensureWorkspaceTrusted(
	workspaceRoot: string,
): Promise<boolean> {
	if (isWorkspaceTrusted(workspaceRoot)) {
		return true;
	}
	p.intro(workspaceRoot);
	p.log.message(
		[
			"Cline automatically loads rules, skills, hooks, and plugins from this",
			"folder, and can read, edit, and run its files. Only continue if you",
			"trust where it came from.",
		].join("\n"),
	);
	const trusted = await p.select({
		message: "Do you trust the files in this folder?",
		options: [
			{ value: true, label: "Yes, I trust this folder" },
			{ value: false, label: "No, exit" },
		],
	});
	if (trusted !== true) {
		return false;
	}
	trustWorkspace(workspaceRoot);
	return true;
}
