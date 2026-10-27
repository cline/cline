"use client";

/**
 * Host shell bridge for embedding the desktop webview inside another native
 * host (currently the VS Code extension at `apps/examples/vscode-desktop`).
 *
 * The desktop UI has a small set of "native" commands (directory picker,
 * notifications, app lifecycle) that the Tauri shell answers over its
 * `invoke` bridge. A host that is not Tauri can provide the same surface by
 * installing `window.__CLINE_HOST_SHELL__` before the app boots. Commands
 * are posted to the host and answered asynchronously with a matching id.
 *
 * Protocol (host ↔ webview, via `postMessage`):
 *   webview → host: { type: "cline-host-command", id, command, args }
 *   host → webview: { type: "cline-host-response", id, ok, result?, error? }
 */

export type HostShellKind = "vscode";

export type HostShellConfig = {
	kind: HostShellKind;
	/** Commands the host answers itself. Everything else goes to the sidecar. */
	commands: string[];
};

type HostCommandMessage = {
	type: "cline-host-command";
	id: string;
	command: string;
	args?: Record<string, unknown>;
};

type HostResponseMessage = {
	type: "cline-host-response";
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
};

type HostPostMessage = (message: unknown) => void;

const HOST_SHELL_KEY = "__CLINE_HOST_SHELL__";
const HOST_POST_MESSAGE_KEY = "__CLINE_HOST_POST_MESSAGE__";
const HOST_COMMAND_TIMEOUT_MS = 120_000;

function readWindowValue<T>(key: string): T | undefined {
	if (typeof window === "undefined") return undefined;
	return (window as unknown as Record<string, unknown>)[key] as T | undefined;
}

export function getHostShell(): HostShellConfig | undefined {
	const value = readWindowValue<unknown>(HOST_SHELL_KEY);
	if (!value || typeof value !== "object") return undefined;
	const config = value as Partial<HostShellConfig>;
	if (config.kind !== "vscode" || !Array.isArray(config.commands)) {
		return undefined;
	}
	return { kind: config.kind, commands: config.commands };
}

export function isHostShellAvailable(): boolean {
	return getHostShell() !== undefined;
}

export function hostShellHandlesCommand(command: string): boolean {
	const shell = getHostShell();
	return Boolean(shell?.commands.includes(command));
}

function isHostResponse(value: unknown): value is HostResponseMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "cline-host-response" &&
		typeof (value as { id?: unknown }).id === "string"
	);
}

let requestCounter = 0;
const pending = new Map<
	string,
	{
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
		timeoutId: ReturnType<typeof setTimeout>;
	}
>();
let listening = false;

function ensureListener(): void {
	if (listening || typeof window === "undefined") return;
	listening = true;
	window.addEventListener("message", (event: MessageEvent) => {
		const data = event.data;
		if (!isHostResponse(data)) return;
		const entry = pending.get(data.id);
		if (!entry) return;
		pending.delete(data.id);
		clearTimeout(entry.timeoutId);
		if (data.ok) {
			entry.resolve(data.result);
		} else {
			entry.reject(new Error(data.error ?? `host command failed`));
		}
	});
}

function resolvePostMessage(): HostPostMessage {
	const direct = readWindowValue<HostPostMessage>(HOST_POST_MESSAGE_KEY);
	if (typeof direct === "function") return direct;
	throw new Error("host shell is not initialised");
}

// ── Host → webview actions ────────────────────────────────────────────────
//
// The host can drive the app too, e.g. VS Code keybindings bound to
// "new session" or "open settings". Message shape:
//   host → webview: { type: "cline-host-action", action, payload? }

export type HostAction =
	| "new-session"
	| "command-bar"
	| "open-settings"
	| "show-sessions"
	| "focus-input"
	/** Payload: {@link HostPromptContext}. Appends to the composer. */
	| "add-to-prompt";

/**
 * Editor context the host hands to the composer (VS Code: "Add to Cline" on
 * a selection). `path` is workspace-relative when the file is inside the
 * workspace; lines are 1-based and inclusive.
 */
export type HostPromptContext = {
	path: string;
	startLine?: number;
	endLine?: number;
	language?: string;
	text: string;
};

export function parseHostPromptContext(
	value: unknown,
): HostPromptContext | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (typeof record.path !== "string" || typeof record.text !== "string") {
		return null;
	}
	const line = (key: string) =>
		typeof record[key] === "number" && Number.isInteger(record[key])
			? (record[key] as number)
			: undefined;
	return {
		path: record.path,
		text: record.text,
		startLine: line("startLine"),
		endLine: line("endLine"),
		language: typeof record.language === "string" ? record.language : undefined,
	};
}

/**
 * Markdown block for a host-provided selection: the file as an `@path`
 * mention (so the composer chips it and the SDK attaches the file), the line
 * range in prose, then the selected lines fenced. The mention must stay a
 * bare path: the SDK matches the whole `@token` against the file index, so a
 * `:12-20` suffix would silently drop the attachment. Paths with whitespace
 * can't be mentions and are written as code instead. The fence grows past
 * any backtick run inside the selection.
 */
export function formatHostPromptContext(context: HostPromptContext): string {
	const { path, startLine, endLine, language, text } = context;
	const file = /\s/.test(path) ? `\`${path}\`` : `@${path}`;
	const range =
		startLine === undefined
			? ""
			: endLine === undefined || endLine === startLine
				? ` (line ${startLine})`
				: ` (lines ${startLine}-${endLine})`;
	const longestRun = Math.max(
		2,
		...[...text.matchAll(/`+/g)].map((match) => match[0].length),
	);
	const fence = "`".repeat(longestRun + 1);
	const body = text.endsWith("\n") ? text : `${text}\n`;
	return `${file}${range}\n${fence}${language ?? ""}\n${body}${fence}\n`;
}

/** Appends `block` to an existing draft, separated by a blank line. */
export function appendToPromptDraft(draft: string, block: string): string {
	if (!draft.trim()) return block;
	return `${draft.replace(/\s+$/, "")}\n\n${block}`;
}

type HostActionMessage = {
	type: "cline-host-action";
	action: HostAction;
	payload?: unknown;
};

function isHostAction(value: unknown): value is HostActionMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "cline-host-action" &&
		typeof (value as { action?: unknown }).action === "string"
	);
}

export function subscribeToHostActions(
	handler: (action: HostAction, payload?: unknown) => void,
): () => void {
	if (typeof window === "undefined" || !isHostShellAvailable()) {
		return () => {};
	}
	const listener = (event: MessageEvent) => {
		if (isHostAction(event.data))
			handler(event.data.action, event.data.payload);
	};
	window.addEventListener("message", listener);
	// Tell the host someone is listening, so actions it queued while the
	// app was still booting (e.g. "Add to Cline" before the view opened) are
	// delivered now instead of being dropped.
	try {
		resolvePostMessage()({ type: "cline-host-ready" });
	} catch {
		// No post bridge (tests); nothing was queued either.
	}
	return () => window.removeEventListener("message", listener);
}

/**
 * Send a native command to the embedding host. Rejects when no host shell is
 * installed, the host reports an error, or no answer arrives in time.
 */
export async function invokeHostShell<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	const post = resolvePostMessage();
	ensureListener();
	const id = `host_${Date.now()}_${requestCounter++}`;
	const message: HostCommandMessage = {
		type: "cline-host-command",
		id,
		command,
		args,
	};
	return await new Promise<T>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`host command timed out: ${command}`));
		}, HOST_COMMAND_TIMEOUT_MS);
		pending.set(id, {
			resolve: (value) => resolve(value as T),
			reject,
			timeoutId,
		});
		try {
			post(message);
		} catch (error) {
			pending.delete(id);
			clearTimeout(timeoutId);
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}
