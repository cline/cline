/**
 * Editor selection → `HostPromptContext` (see desktop-app/webview/lib/
 * host-shell.ts), the payload of the `add-to-prompt` host action. Kept free
 * of the `vscode` module so it can be unit-tested.
 */
export type PromptContext = {
	path: string;
	startLine: number;
	endLine: number;
	language?: string;
	text: string;
};

/** VS Code language ids that differ from the usual markdown fence tag. */
const FENCE_LANGUAGE: Record<string, string> = {
	typescriptreact: "tsx",
	javascriptreact: "jsx",
	shellscript: "sh",
	plaintext: "",
};

export function buildPromptContext(options: {
	absolutePath: string;
	/** Workspace-relative path when the file is inside a workspace folder. */
	relativePath?: string;
	languageId: string;
	/** 0-based, inclusive (VS Code positions). */
	startLine: number;
	endLine: number;
	text: string;
}): PromptContext {
	const language =
		FENCE_LANGUAGE[options.languageId] ?? options.languageId ?? "";
	return {
		// asRelativePath uses OS separators; mentions use forward slashes.
		path: (options.relativePath ?? options.absolutePath).replace(/\\/g, "/"),
		startLine: options.startLine + 1,
		endLine: Math.max(options.startLine, options.endLine) + 1,
		language: language || undefined,
		text: options.text,
	};
}
