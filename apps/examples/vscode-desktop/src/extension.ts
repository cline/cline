/**
 * Cline Desktop inside VS Code — prototype.
 *
 * The extension does three things:
 *   1. Spawns the desktop app's backend (apps/examples/desktop-app/sidecar)
 *      exactly as the Tauri shell would.
 *   2. Serves the desktop app's Next.js static export in a webview (sidebar
 *      and/or editor tab), pointing it at the backend's WebSocket.
 *   3. Answers the handful of "native shell" commands with the vscode API.
 *
 * Everything else — sessions, providers, MCP, settings, tool approvals — is
 * the unmodified desktop code talking over its own transport.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import * as vscode from "vscode";
import { DesktopBackend, resolveDefaultBackendEntry } from "./backend";
import { registerDiffProvider } from "./diff-provider";
import {
	HOST_COMMANDS,
	type HostCommandContext,
	runHostCommand,
} from "./host-commands";
import { buildWebviewHtml } from "./webview-html";

const VIEW_ID = "clineDesktop.sidebar";
const PANEL_VIEW_TYPE = "clineDesktop.panel";

let backend: DesktopBackend | undefined;
let logs: vscode.OutputChannel | undefined;
let panel: vscode.WebviewPanel | undefined;

function resolveWorkspaceRoot(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function resolveRuntimePath(extensionRoot: string): string {
	const configured = vscode.workspace
		.getConfiguration("clineDesktop")
		.get<string>("bunPath")
		?.trim();
	if (configured) return configured;
	// Packaged builds ship a compiled cline CLI (scripts/build-runtime.ts); it
	// runs the backend bundle on its embedded runtime, so no bun is needed.
	const bundledCli = join(
		extensionRoot,
		"dist",
		"bin",
		process.platform === "win32" ? "cline-cli.exe" : "cline-cli",
	);
	if (existsSync(bundledCli)) return bundledCli;
	// The extension host's PATH is often the minimal launchd PATH on macOS;
	// probe common bun locations before falling back to plain `bun`.
	const home = process.env.HOME ?? "";
	const candidates = [
		join(home, ".bun", "bin", "bun"),
		"/opt/homebrew/bin/bun",
		"/usr/local/bin/bun",
		...(process.env.PATH ?? "")
			.split(delimiter)
			.filter(Boolean)
			.map((dir) => join(dir, "bun")),
	];
	// mise-managed bun (this repo pins 1.4.2 in .tool-versions).
	const miseBun = join(
		home,
		".local",
		"share",
		"mise",
		"installs",
		"bun",
		"1.4.2",
		"bin",
		"bun",
	);
	if (existsSync(miseBun)) candidates.unshift(miseBun);
	return candidates.find((path) => existsSync(path)) ?? "bun";
}

function resolveEntryPath(extensionRoot: string): string {
	const configured = vscode.workspace
		.getConfiguration("clineDesktop")
		.get<string>("backendEntry")
		?.trim();
	return configured || resolveDefaultBackendEntry(extensionRoot);
}

function ensureBackend(context: vscode.ExtensionContext): DesktopBackend {
	if (backend) return backend;
	const output = logs ?? vscode.window.createOutputChannel("Cline Desktop");
	logs = output;
	backend = new DesktopBackend({
		runtimePath: resolveRuntimePath(context.extensionPath),
		entryPath: resolveEntryPath(context.extensionPath),
		workspaceRoot: resolveWorkspaceRoot(),
		logger: {
			log: (message) => output.appendLine(message),
			error: (message) => output.appendLine(`ERROR ${message}`),
		},
		onExit: (code) => {
			if (code !== null && code !== 0) {
				void vscode.window
					.showErrorMessage(
						`Cline Desktop backend exited with code ${code}.`,
						"Show Logs",
						"Restart",
					)
					.then((choice) => {
						if (choice === "Show Logs") output.show();
						if (choice === "Restart") void backend?.restart();
					});
			}
		},
	});
	return backend;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function loadingHtml(message: string, isError = false): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1rem; }
.err { color: var(--vscode-errorForeground); white-space: pre-wrap; }
</style></head>
<body><p class="${isError ? "err" : ""}">${message}</p>
${isError ? "<p>See the <b>Cline Desktop</b> output channel for backend logs.</p>" : ""}
</body></html>`;
}

/** Live webviews, most recently focused last; host actions go to the last one. */
const activeWebviews = new Set<DesktopWebview>();

type HostAction = "new-session" | "command-bar" | "open-settings" | "focus-input";

function postHostAction(action: HostAction): void {
	const target = [...activeWebviews].at(-1);
	if (!target) {
		// Nothing open yet: open the sidebar, which will render fresh state.
		void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		return;
	}
	target.reveal();
	void target.postHostAction(action);
}

class DesktopWebview {
	private disposables: vscode.Disposable[] = [];

	constructor(
		private readonly webview: vscode.Webview,
		private readonly context: vscode.ExtensionContext,
		readonly reveal: () => void,
	) {
		webview.options = {
			enableScripts: true,
			localResourceRoots: [this.distDir()],
		};
		this.disposables.push(
			webview.onDidReceiveMessage((message) => void this.onMessage(message)),
		);
		activeWebviews.add(this);
		void this.render();
	}

	dispose(): void {
		activeWebviews.delete(this);
		for (const disposable of this.disposables) disposable.dispose();
		this.disposables = [];
	}

	/** Mark this webview as the most recently used target for host actions. */
	touch(): void {
		activeWebviews.delete(this);
		activeWebviews.add(this);
	}

	postHostAction(action: HostAction, payload?: unknown): Thenable<boolean> {
		return this.webview.postMessage({
			type: "cline-host-action",
			action,
			payload,
		});
	}

	private distDir(): vscode.Uri {
		return vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
	}

	private hostContext(): HostCommandContext {
		return {
			workspaceRoot: resolveWorkspaceRoot(),
			restartBackend: () => ensureBackend(this.context).restart(),
			backendWsEndpoint: () => backend?.current?.wsEndpoint,
			revealWebview: () => this.reveal(),
		};
	}

	private async onMessage(message: unknown): Promise<void> {
		if (
			!message ||
			typeof message !== "object" ||
			(message as { type?: unknown }).type !== "cline-host-command"
		) {
			return;
		}
		const { id, command, args } = message as {
			id: string;
			command: string;
			args?: Record<string, unknown>;
		};
		try {
			const result = await runHostCommand(command, args, this.hostContext());
			await this.webview.postMessage({
				type: "cline-host-response",
				id,
				ok: true,
				result,
			});
		} catch (error) {
			await this.webview.postMessage({
				type: "cline-host-response",
				id,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async render(): Promise<void> {
		this.webview.html = loadingHtml("Starting Cline Desktop backend…");
		try {
			const endpoint = await ensureBackend(this.context).ready();
			const distDir = this.distDir();
			const indexPath = vscode.Uri.joinPath(distDir, "index.html").fsPath;
			if (!existsSync(indexPath)) {
				throw new Error(
					`webview assets not built (${indexPath}); run \`bun run build\` in apps/examples/vscode-desktop`,
				);
			}
			const html = await readFile(indexPath, "utf8");
			const resolveAsset = (relativePath: string) =>
				this.webview
					.asWebviewUri(vscode.Uri.joinPath(distDir, relativePath))
					.toString();
			this.webview.html = buildWebviewHtml({
				html,
				resolveAsset,
				cspSource: this.webview.cspSource,
				wsEndpoint: endpoint.wsEndpoint,
				hostCommands: HOST_COMMANDS,
				chunkBaseUrl: resolveAsset("_next/"),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logs?.appendLine(`ERROR ${message}`);
			this.webview.html = loadingHtml(
				`Cline Desktop failed to start: ${escapeHtml(message)}`,
				true,
			);
		}
	}
}

class SidebarProvider implements vscode.WebviewViewProvider {
	private view: DesktopWebview | undefined;
	constructor(private readonly context: vscode.ExtensionContext) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view?.dispose();
		const view = new DesktopWebview(webviewView.webview, this.context, () =>
			webviewView.show(true),
		);
		this.view = view;
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) view.touch();
		});
		webviewView.onDidDispose(() => {
			this.view?.dispose();
			this.view = undefined;
		});
	}
}

function openPanel(context: vscode.ExtensionContext): void {
	if (panel) {
		panel.reveal();
		return;
	}
	panel = vscode.window.createWebviewPanel(
		PANEL_VIEW_TYPE,
		"Cline Desktop",
		vscode.ViewColumn.Beside,
		{ retainContextWhenHidden: true },
	);
	panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");
	const openedPanel = panel;
	const view = new DesktopWebview(panel.webview, context, () =>
		openedPanel.reveal(undefined, true),
	);
	panel.onDidChangeViewState((event) => {
		if (event.webviewPanel.active) view.touch();
	});
	panel.onDidDispose(() => {
		view.dispose();
		panel = undefined;
	});
}

export function activate(context: vscode.ExtensionContext): void {
	logs = vscode.window.createOutputChannel("Cline Desktop");
	context.subscriptions.push(logs);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			VIEW_ID,
			new SidebarProvider(context),
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
		vscode.commands.registerCommand("clineDesktop.open", () =>
			openPanel(context),
		),
		vscode.commands.registerCommand("clineDesktop.restartBackend", async () => {
			try {
				await ensureBackend(context).restart();
				void vscode.window.showInformationMessage(
					"Cline Desktop backend restarted. Reload the webview to reconnect.",
				);
			} catch (error) {
				void vscode.window.showErrorMessage(
					`Restart failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
		vscode.commands.registerCommand("clineDesktop.showLogs", () =>
			logs?.show(),
		),
		// Keyboard shortcuts live in VS Code's keybindings (see package.json);
		// each one forwards an action the app also exposes to its own shortcuts.
		vscode.commands.registerCommand("clineDesktop.newSession", () =>
			postHostAction("new-session"),
		),
		vscode.commands.registerCommand("clineDesktop.searchSessions", () =>
			postHostAction("command-bar"),
		),
		vscode.commands.registerCommand("clineDesktop.openSettings", () =>
			postHostAction("open-settings"),
		),
		vscode.commands.registerCommand("clineDesktop.focusInput", () =>
			postHostAction("focus-input"),
		),
		registerDiffProvider(),
	);
	// Warm the backend so the first webview open is fast.
	void ensureBackend(context)
		.ready()
		.catch((error) => {
			logs?.appendLine(
				`ERROR backend warmup failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
}

export async function deactivate(): Promise<void> {
	panel?.dispose();
	await backend?.stop();
	backend = undefined;
}

