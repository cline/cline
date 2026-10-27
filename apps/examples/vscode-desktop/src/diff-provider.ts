/**
 * Backs `open_file_diff`: the webview hands us before/after text for a file
 * the agent changed, and we show it in VS Code's native diff editor.
 *
 * Contents are served through a `cline-diff:` content provider so nothing
 * touches the disk; the right-hand side is the real file when it still
 * exists (so the user can keep editing), otherwise the "after" snapshot.
 */
import { existsSync } from "node:fs";
import * as vscode from "vscode";

export const DIFF_SCHEME = "cline-diff";

const snapshots = new Map<string, string>();
let counter = 0;

const provider: vscode.TextDocumentContentProvider = {
	provideTextDocumentContent(uri) {
		return snapshots.get(uri.toString()) ?? "";
	},
};

export function registerDiffProvider(): vscode.Disposable {
	return vscode.workspace.registerTextDocumentContentProvider(
		DIFF_SCHEME,
		provider,
	);
}

function snapshotUri(
	path: string,
	side: "old" | "new",
	text: string,
): vscode.Uri {
	const uri = vscode.Uri.from({
		scheme: DIFF_SCHEME,
		path: `/${side}/${++counter}${path}`,
		query: side,
	});
	snapshots.set(uri.toString(), text);
	return uri;
}

export async function openFileDiff(options: {
	path: string;
	title?: string;
	oldText: string;
	newText: string;
	status?: "A" | "M" | "D";
	viewColumn?: vscode.ViewColumn;
}): Promise<void> {
	const left = snapshotUri(options.path, "old", options.oldText);
	const fileOnDisk = options.status !== "D" && existsSync(options.path);
	const right = fileOnDisk
		? vscode.Uri.file(options.path)
		: snapshotUri(options.path, "new", options.newText);
	await vscode.commands.executeCommand(
		"vscode.diff",
		left,
		right,
		options.title ?? `${options.path} (Cline changes)`,
		{ preview: true, viewColumn: options.viewColumn },
	);
}
