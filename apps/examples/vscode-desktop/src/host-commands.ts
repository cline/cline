/**
 * VS Code implementations of the desktop app's "native shell" commands.
 *
 * In the Tauri app these are `#[tauri::command]`s in src-tauri/src/main.rs
 * and are routed by `NATIVE_COMMANDS` in webview/lib/desktop-client.ts. Here
 * the webview posts them to the extension host (see webview/lib/host-shell.ts)
 * and we answer with the `vscode` API. Anything not listed in
 * `HOST_COMMANDS` still goes to the sidecar over its WebSocket.
 */
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import { openFileDiff } from "./diff-provider";
import { invokeSidecar } from "./sidecar-client";

export type HostCommandContext = {
	workspaceRoot: string;
	restartBackend: () => Promise<unknown>;
	backendWsEndpoint: () => string | undefined;
	/** Bring the webview that issued the command back into view. */
	revealWebview: () => void;
	/**
	 * Column for files opened from the transcript: never the one Cline's
	 * panel occupies, so opening a file doesn't cover the conversation.
	 */
	editorColumn: () => vscode.ViewColumn;
};

type HostCommandHandler = (
	args: Record<string, unknown> | undefined,
	ctx: HostCommandContext,
) => Promise<unknown>;

function stringArg(
	args: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = args?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 1-based line from `args.line`, if it is a positive integer. */
export function lineArg(
	args: Record<string, unknown> | undefined,
): number | undefined {
	const value = args?.line;
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: undefined;
}

/**
 * Absolute path for a file the transcript mentions: absolute paths as-is,
 * `~/` against the home directory, everything else against `base` (the
 * session's working directory).
 */
export function resolveEditorPath(raw: string, base: string): string {
	if (raw === "~" || raw.startsWith("~/")) {
		return join(homedir(), raw.slice(1));
	}
	return isAbsolute(raw) ? raw : join(base, raw);
}

const handlers: Record<string, HostCommandHandler> = {
	// ── Native dialogs / OS integration ────────────────────────────────
	async pick_workspace_directory(args) {
		const initial = stringArg(args, "initialPath");
		const picked = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			defaultUri: initial ? vscode.Uri.file(initial) : undefined,
			openLabel: "Use as workspace",
		});
		return picked?.[0]?.fsPath ?? null;
	},

	async open_external_url(args) {
		const url = stringArg(args, "url");
		if (!url) throw new Error("url is required");
		const parsed = vscode.Uri.parse(url);
		if (!["http", "https", "mailto", "tel"].includes(parsed.scheme)) {
			throw new Error("only http(s), mailto and tel urls can be opened");
		}
		await vscode.env.openExternal(parsed);
		return { opened: true };
	},

	async open_file_in_editor(args, ctx) {
		const raw = stringArg(args, "path");
		if (!raw) throw new Error("path is required");
		const base = stringArg(args, "cwd") ?? ctx.workspaceRoot;
		const filePath = resolveEditorPath(raw, base);
		const document = await vscode.workspace.openTextDocument(
			vscode.Uri.file(filePath),
		);
		const line = lineArg(args);
		const position =
			line === undefined
				? undefined
				: new vscode.Position(Math.min(line, document.lineCount) - 1, 0);
		await vscode.window.showTextDocument(document, {
			preview: false,
			viewColumn: ctx.editorColumn(),
			selection: position ? new vscode.Range(position, position) : undefined,
		});
		return { path: filePath, editor: "vscode" };
	},

	async open_file_diff(args, ctx) {
		const path = stringArg(args, "path");
		if (!path) throw new Error("path is required");
		const oldText = typeof args?.oldText === "string" ? args.oldText : "";
		const newText = typeof args?.newText === "string" ? args.newText : "";
		const status = args?.status;
		await openFileDiff({
			path,
			title: stringArg(args, "title"),
			oldText,
			newText,
			status:
				status === "A" || status === "M" || status === "D" ? status : undefined,
			viewColumn: ctx.editorColumn(),
		});
		return { opened: true };
	},

	async list_available_editors() {
		return [{ id: "vscode", name: vscode.env.appName, available: true }];
	},

	async open_mcp_settings_file(_args, ctx) {
		// The sidecar owns the settings path (and creates the file if missing);
		// ask it, then open the file in VS Code instead of an external editor.
		const wsEndpoint = ctx.backendWsEndpoint();
		if (!wsEndpoint) throw new Error("desktop backend is not running");
		const path = await invokeSidecar<string>(
			wsEndpoint,
			"ensure_mcp_settings_file",
		);
		const document = await vscode.workspace.openTextDocument(
			vscode.Uri.file(path),
		);
		await vscode.window.showTextDocument(document, { preview: false });
		return path;
	},

	async show_session_notification(args, ctx) {
		const title = stringArg(args, "title") ?? "Cline";
		const body = stringArg(args, "body");
		void vscode.window
			.showInformationMessage(body ? `${title}: ${body}` : title, "Show")
			.then((choice) => {
				if (choice === "Show") ctx.revealWebview();
			});
		return null;
	},

	// ── App lifecycle: mostly no-ops inside VS Code ────────────────────
	async get_update_status() {
		return { state: "idle" };
	},
	async check_for_update_now() {
		return { state: "idle" };
	},
	async restart_to_apply_update() {
		return null;
	},
	async relaunch_app(_args, ctx) {
		await ctx.restartBackend();
		return null;
	},
	async quit_app() {
		return null;
	},
	async set_quit_shortcut_native() {
		return null;
	},
	async set_app_icon() {
		return null;
	},
	async set_tray_status() {
		return null;
	},
	async drain_desktop_actions() {
		return [];
	},
};

/** Commands the webview should route to the host instead of the sidecar. */
export const HOST_COMMANDS: string[] = Object.keys(handlers);

export async function runHostCommand(
	command: string,
	args: Record<string, unknown> | undefined,
	ctx: HostCommandContext,
): Promise<unknown> {
	const handler = handlers[command];
	if (!handler) {
		throw new Error(`unsupported host command: ${command}`);
	}
	return await handler(args, ctx);
}
