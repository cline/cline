/**
 * VS Code implementations of the desktop app's "native shell" commands.
 *
 * In the Tauri app these are `#[tauri::command]`s in src-tauri/src/main.rs
 * and are routed by `NATIVE_COMMANDS` in webview/lib/desktop-client.ts. Here
 * the webview posts them to the extension host (see webview/lib/host-shell.ts)
 * and we answer with the `vscode` API. Anything not listed in
 * `HOST_COMMANDS` still goes to the sidecar over its WebSocket.
 */
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import { invokeSidecar } from "./sidecar-client";

export type HostCommandContext = {
	workspaceRoot: string;
	restartBackend: () => Promise<unknown>;
	backendWsEndpoint: () => string | undefined;
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
		const filePath = isAbsolute(raw) ? raw : join(base, raw);
		const document = await vscode.workspace.openTextDocument(
			vscode.Uri.file(filePath),
		);
		await vscode.window.showTextDocument(document, { preview: false });
		return { path: filePath, editor: "vscode" };
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

	async show_session_notification(args) {
		const title = stringArg(args, "title") ?? "Cline";
		const body = stringArg(args, "body");
		void vscode.window.showInformationMessage(body ? `${title}: ${body}` : title);
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
