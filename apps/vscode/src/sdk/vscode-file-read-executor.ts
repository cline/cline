import { createDefaultExecutors, type ToolExecutors } from "@cline/core"
import * as path from "path"

type FileReadExecutor = NonNullable<ToolExecutors["readFile"]>

/**
 * `read_files` executor override that resolves relative paths against the workspace
 * root before delegating to the SDK's built-in file reader.
 *
 * The built-in executor resolves relative paths against `process.cwd()`, which in a
 * VS Code extension host is usually "/" — not the workspace — so every relative-path
 * read failed with ENOENT and pushed the model into terminal fallbacks. The terminal
 * and editor tools already run against the workspace root; this makes reads match.
 */
export function createWorkspaceFileReadExecutor(getWorkspaceRoot: () => Promise<string>): FileReadExecutor {
	const readFile = createDefaultExecutors().readFile
	if (!readFile) {
		throw new Error("SDK default executors did not provide a readFile executor")
	}
	return async (request, context) => {
		if (path.isAbsolute(request.path)) {
			return readFile(request, context)
		}
		const workspaceRoot = await getWorkspaceRoot()
		return readFile({ ...request, path: path.resolve(workspaceRoot, request.path) }, context)
	}
}
