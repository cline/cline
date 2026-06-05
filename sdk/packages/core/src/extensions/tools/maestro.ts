/**
 * Maestro Tools
 *
 * AgentTool definitions for driving isolated Docker desktop sessions managed
 * by a `maestro-daemon` process (see https://github.com/dominiccooney/maestro).
 *
 * Each tool is a thin HTTP wrapper around the daemon's REST API:
 *
 *   GET    {daemonUrl}/sessions
 *   POST   {daemonUrl}/sessions          { container_id?, label? }
 *   DELETE {daemonUrl}/sessions/:id
 *   POST   {daemonUrl}/sessions/:id/action  { action, ...args }
 *   POST   {daemonUrl}/sessions/:id/exec    { cmd, cwd?, gui?, background?, tty?, env? }
 *
 * Why schema'd tools (e.g. maestro_click), not the Anthropic `computer_20250124`
 * beta tool?
 *
 *   - The SDK's Anthropic-compatible provider doesn't currently support the
 *     `computer-use-2025-01-24` beta header / opaque tool type. Adding that
 *     would be a multi-day provider-layer change.
 *   - Schema'd tools work today, with any model, and naturally support
 *     multiple sessions in one task — every call carries an explicit
 *     `session_id`. No "focused session" state to track.
 *   - Trained pixel precision is lost (vs computer_20250124), but for an
 *     end-to-end debug-VSCode-in-a-container demo, JSON tool calls are fine.
 *
 * The tools mirror the Rust `maestro-mcp` server one-for-one (same daemon
 * REST endpoints, same parameter names) so a user can swap between MCP and
 * native SDK tools without behavior changes.
 *
 * Usage:
 *
 *   import { createMaestroTools, createDefaultTools } from "@cline/core"
 *
 *   const tools = [
 *     ...createDefaultTools({ ... }),
 *     ...createMaestroTools({ daemonUrl: "http://localhost:8765" }),
 *   ]
 *
 *   const agent = new Agent({ ..., tools })
 *
 * `daemonUrl` defaults to `http://localhost:8765` (the maestro-daemon default).
 * If `fetch` is not globally available in the target runtime (e.g. very old
 * Node), the caller can override via `createMaestroTools({ fetch: customFetch })`.
 */

import { type AgentTool, createTool } from "@cline/shared";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for `createMaestroTools`.
 */
export interface CreateMaestroToolsOptions {
	/**
	 * URL of the maestro-daemon REST API. Defaults to `http://localhost:8765`.
	 */
	daemonUrl?: string;
	/**
	 * Per-action HTTP timeout in milliseconds. Defaults to 30_000.
	 * Screenshots can be ~tens of KB but should still resolve quickly when the
	 * daemon + bridge are healthy.
	 */
	timeoutMs?: number;
	/**
	 * Override the global `fetch` implementation (e.g. for tests). Defaults to
	 * `globalThis.fetch`.
	 */
	fetch?: typeof fetch;
}

/**
 * Build the full set of Maestro tools. Returns an array suitable for
 * concatenation with `createDefaultTools(...)`.
 */
export function createMaestroTools(
	options: CreateMaestroToolsOptions = {},
): AgentTool[] {
	const client = new MaestroClient(options);
	return [
		createMaestroListSessionsTool(client),
		createMaestroCreateSessionTool(client),
		createMaestroDestroySessionTool(client),
		createMaestroExecTool(client),
		createMaestroScreenshotTool(client),
		createMaestroClickTool(client),
		createMaestroTypeTool(client),
		createMaestroKeyTool(client),
		createMaestroScrollTool(client),
		createMaestroZoomTool(client),
	] as AgentTool[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP client
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DAEMON_URL = "http://localhost:8765";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Thin HTTP wrapper around the maestro-daemon REST API. Lives on the closure
 * of each tool's `execute()` so the tools can share connection state if any
 * is added later (currently stateless).
 */
class MaestroClient {
	private readonly daemonUrl: string;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof fetch;

	constructor(options: CreateMaestroToolsOptions) {
		this.daemonUrl = (options.daemonUrl ?? DEFAULT_DAEMON_URL).replace(
			/\/+$/,
			"",
		);
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const f = options.fetch ?? globalThis.fetch;
		if (typeof f !== "function") {
			throw new Error(
				"createMaestroTools: no fetch implementation available. " +
					"Pass options.fetch or run on a runtime that exposes a global fetch.",
			);
		}
		this.fetchImpl = f;
	}

	private withTimeout(signal?: AbortSignal): AbortSignal {
		// Compose the caller's abort signal (if any) with our own timeout.
		const controller = new AbortController();
		const onAbort = () => controller.abort(signal?.reason);
		if (signal?.aborted) {
			controller.abort(signal.reason);
		} else {
			signal?.addEventListener("abort", onAbort, { once: true });
		}
		const timer = setTimeout(
			() =>
				controller.abort(
					new Error(`maestro request timed out after ${this.timeoutMs}ms`),
				),
			this.timeoutMs,
		);
		// Best-effort: clear the timer if the caller aborts first.
		controller.signal.addEventListener("abort", () => clearTimeout(timer), {
			once: true,
		});
		return controller.signal;
	}

	async get(path: string, signal?: AbortSignal): Promise<unknown> {
		const res = await this.fetchImpl(`${this.daemonUrl}${path}`, {
			method: "GET",
			signal: this.withTimeout(signal),
		});
		return parseResponse(res);
	}

	async post(
		path: string,
		body: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		const res = await this.fetchImpl(`${this.daemonUrl}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body ?? {}),
			signal: this.withTimeout(signal),
		});
		return parseResponse(res);
	}

	async del(path: string, signal?: AbortSignal): Promise<unknown> {
		const res = await this.fetchImpl(`${this.daemonUrl}${path}`, {
			method: "DELETE",
			signal: this.withTimeout(signal),
		});
		return parseResponse(res);
	}

	/**
	 * Helper for the unified `POST /sessions/:id/action` endpoint, which is
	 * how every interaction (screenshot/click/type/...) reaches the bridge.
	 */
	async action(
		sessionId: string,
		body: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		const result = await this.post(
			`/sessions/${encodeURIComponent(sessionId)}/action`,
			body,
			signal,
		);
		return (result ?? {}) as Record<string, unknown>;
	}
}

async function parseResponse(res: Response): Promise<unknown> {
	const text = await res.text();
	if (!res.ok) {
		throw new Error(
			`maestro-daemon returned HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
		);
	}
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		// Daemon occasionally returns non-JSON for empty responses (e.g. 204 No Content
		// converted to "" by some intermediaries). Surface the raw text so the caller
		// can decide what to do.
		return { raw: text };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool factories
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_ID_DESC =
	"Session id returned by maestro_list_sessions or maestro_create_session.";

function createMaestroListSessionsTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_list_sessions",
		description:
			"List all running Maestro desktop sessions. Returns an array of " +
			"{ id, label, status, ... } objects. Call this first to discover " +
			"available sessions before issuing screenshot/click/type calls.",
		inputSchema: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
		execute: async (_input, context) => {
			return client.get("/sessions", context.signal);
		},
	}) as AgentTool;
}

function createMaestroCreateSessionTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_create_session",
		description:
			"Create a new isolated Maestro desktop session inside the configured " +
			"Docker container. Returns the new session_id. Use the returned id in " +
			"subsequent screenshot/click/type calls.",
		inputSchema: {
			type: "object",
			properties: {
				label: {
					type: "string",
					description: "Optional human-readable label for the new session.",
				},
				container_id: {
					type: "string",
					description:
						"Optional existing Docker container name/id to create the session " +
						"in. Use this to attach a session to a container that already has " +
						"your workspace bind-mounted (e.g. the one the daemon was started " +
						"with). When omitted, the daemon starts a fresh container from its " +
						"configured image.",
				},
				mounts: {
					type: "array",
					items: { type: "string" },
					description:
						"Optional Docker bind mounts for a NEW container, each in " +
						"'/host/path:/container/path[:ro]' form. Only applied when the " +
						"daemon starts a fresh container (i.e. when container_id is omitted); " +
						"ignored when attaching to an existing container_id. Lets one daemon " +
						"serve multiple workspaces by mounting a different host checkout per " +
						"session. When omitted, the daemon falls back to its global --mount " +
						"args (which may be none, in which case the container has no mounts).",
				},
			},
			required: [],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { label, container_id, mounts } = input as {
				label?: string;
				container_id?: string;
				mounts?: string[];
			};
			const body: Record<string, unknown> = {};
			if (typeof label === "string" && label) {
				body.label = label;
			}
			if (typeof container_id === "string" && container_id) {
				body.container_id = container_id;
			}
			if (Array.isArray(mounts) && mounts.length > 0) {
				body.mounts = mounts;
			}
			return client.post("/sessions", body, context.signal);
		},
	}) as AgentTool;
}

function createMaestroDestroySessionTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_destroy_session",
		description:
			"Destroy a Maestro session and free its container resources. The " +
			"session_id becomes invalid after this call.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: SESSION_ID_DESC },
			},
			required: ["session_id"],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { session_id } = input as { session_id: string };
			await client.del(
				`/sessions/${encodeURIComponent(session_id)}`,
				context.signal,
			);
			return { ok: true, session_id };
		},
	}) as AgentTool;
}
function createMaestroExecTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_exec",
		description:
			"Run a shell command inside the Docker container backing a Maestro " +
			"session, and return its stdout/stderr/exit code. The command runs via " +
			"`bash -lc`. DISPLAY is set to the session's X display by default (gui), " +
			"so GUI apps launched here appear in that session's desktop. Use this to " +
			"build/test code in a bind-mounted workspace and to launch long-running " +
			"servers (e.g. the Cline VS Code debug harness) with background:true. " +
			"Address everything by session_id — the daemon resolves the container " +
			"and display for you.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: SESSION_ID_DESC },
				cmd: {
					type: "string",
					description:
						"Shell command to run (passed to `bash -lc`). " +
						"Example: 'npm run protos && IS_DEV=true node esbuild.mjs'.",
				},
				cwd: {
					type: "string",
					description:
						"Working directory inside the container, e.g. " +
						"'/workspace/cline/apps/vscode'.",
				},
				gui: {
					type: "boolean",
					description:
						"Set DISPLAY=:N for this session so GUI apps target its desktop. " +
						"Defaults to true.",
				},
				background: {
					type: "boolean",
					description:
						"Run detached via `nohup ... &` and return immediately with no " +
						"exit code. Use for GUI apps and long-running servers (e.g. the " +
						"debug harness). Defaults to false.",
				},
				tty: {
					type: "boolean",
					description:
						"Allocate a TTY for the exec. Keep false for clean structured " +
						"stdout/stderr. Defaults to false.",
				},
				env: {
					type: "array",
					items: { type: "string" },
					description: "Extra environment variables in 'KEY=value' form.",
				},
			},
			required: ["session_id", "cmd"],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { session_id, cmd, cwd, gui, background, tty, env } = input as {
				session_id: string;
				cmd: string;
				cwd?: string;
				gui?: boolean;
				background?: boolean;
				tty?: boolean;
				env?: string[];
			};
			const body: Record<string, unknown> = { cmd };
			if (typeof cwd === "string" && cwd) body.cwd = cwd;
			if (typeof gui === "boolean") body.gui = gui;
			if (typeof background === "boolean") body.background = background;
			if (typeof tty === "boolean") body.tty = tty;
			if (Array.isArray(env) && env.length > 0) body.env = env;
			return client.post(
				`/sessions/${encodeURIComponent(session_id)}/exec`,
				body,
				context.signal,
			);
		},
	}) as AgentTool;
}



function createMaestroScreenshotTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_screenshot",
		description:
			"Take a screenshot of a Maestro desktop session and return it as a " +
			"JPEG image. The display is 1280x800 pixels. Call this whenever you " +
			"need to see the current state of the desktop.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: SESSION_ID_DESC },
			},
			required: ["session_id"],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { session_id } = input as { session_id: string };
			const result = await client.action(
				session_id,
				{ action: "screenshot" },
				context.signal,
			);
			return toImageResult(result, `Screenshot of session ${session_id}.`);
		},
	}) as AgentTool;
}

function createMaestroClickTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_click",
		description:
			"Click at (x, y) in a Maestro session. The display is 1280x800 pixels " +
			"with the origin at the top-left. `button` defaults to 'left'; pass " +
			"'right' or 'middle' for the other mouse buttons.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: SESSION_ID_DESC },
				x: { type: "integer", description: "X coordinate (0-1279)." },
				y: { type: "integer", description: "Y coordinate (0-799)." },
				button: {
					type: "string",
					enum: ["left", "right", "middle"],
					description: "Mouse button. Defaults to 'left'.",
				},
			},
			required: ["session_id", "x", "y"],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { session_id, x, y, button } = input as {
				session_id: string;
				x: number;
				y: number;
				button?: "left" | "right" | "middle";
			};
			const action =
				button === "right"
					? "right_click"
					: button === "middle"
						? "middle_click"
						: "left_click";
			await client.action(session_id, { action, x, y }, context.signal);
			return `Clicked ${button ?? "left"} at (${x}, ${y}) in session ${session_id}.`;
		},
	}) as AgentTool;
}

function createMaestroTypeTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_type",
		description:
			"Type text into the currently focused element of a Maestro session. " +
			"Use maestro_click first to focus the target element.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: SESSION_ID_DESC },
				text: { type: "string", description: "Text to type." },
			},
			required: ["session_id", "text"],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { session_id, text } = input as {
				session_id: string;
				text: string;
			};
			await client.action(session_id, { action: "type", text }, context.signal);
			return `Typed ${text.length} characters into session ${session_id}.`;
		},
	}) as AgentTool;
}

function createMaestroKeyTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_key",
		description:
			"Press a key or key combination in a Maestro session, in xdotool " +
			"syntax. Examples: 'Return', 'Escape', 'ctrl+c', 'alt+Tab', 'Super_L'.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: SESSION_ID_DESC },
				key: {
					type: "string",
					description:
						"Key combo in xdotool format (e.g. 'Return', 'ctrl+c', 'alt+F4').",
				},
			},
			required: ["session_id", "key"],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { session_id, key } = input as { session_id: string; key: string };
			await client.action(session_id, { action: "key", key }, context.signal);
			return `Sent key ${key} to session ${session_id}.`;
		},
	}) as AgentTool;
}

function createMaestroScrollTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_scroll",
		description:
			"Scroll at (x, y) in a Maestro session. `direction` is up/down/left/right " +
			"and `amount` is the number of discrete scroll steps.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: SESSION_ID_DESC },
				x: { type: "integer", description: "X coordinate to scroll at." },
				y: { type: "integer", description: "Y coordinate to scroll at." },
				direction: {
					type: "string",
					enum: ["up", "down", "left", "right"],
					description: "Scroll direction.",
				},
				amount: {
					type: "integer",
					description: "Number of discrete scroll steps. Typically 1-10.",
					minimum: 1,
				},
			},
			required: ["session_id", "x", "y", "direction", "amount"],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { session_id, x, y, direction, amount } = input as {
				session_id: string;
				x: number;
				y: number;
				direction: "up" | "down" | "left" | "right";
				amount: number;
			};
			await client.action(
				session_id,
				{ action: "scroll", x, y, direction, amount },
				context.signal,
			);
			return `Scrolled ${direction} x${amount} at (${x}, ${y}) in session ${session_id}.`;
		},
	}) as AgentTool;
}

function createMaestroZoomTool(client: MaestroClient): AgentTool {
	return createTool({
		name: "maestro_zoom",
		description:
			"Zoom into a rectangular region (x0, y0)-(x1, y1) of a Maestro session " +
			"and return that region as a JPEG image. Useful for reading small text " +
			"or inspecting UI details without spending tokens on a full screenshot.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: SESSION_ID_DESC },
				x0: { type: "integer", description: "Left edge of the region." },
				y0: { type: "integer", description: "Top edge of the region." },
				x1: { type: "integer", description: "Right edge (exclusive)." },
				y1: { type: "integer", description: "Bottom edge (exclusive)." },
			},
			required: ["session_id", "x0", "y0", "x1", "y1"],
			additionalProperties: false,
		},
		execute: async (input, context) => {
			const { session_id, x0, y0, x1, y1 } = input as {
				session_id: string;
				x0: number;
				y0: number;
				x1: number;
				y1: number;
			};
			const result = await client.action(
				session_id,
				{ action: "zoom", x0, y0, x1, y1 },
				context.signal,
			);
			return toImageResult(
				result,
				`Zoomed region (${x0}, ${y0})-(${x1}, ${y1}) of session ${session_id}.`,
			);
		},
	}) as AgentTool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert the daemon's `{ data: <base64 jpeg> }` action result into the
 * AI-SDK content-block array shape that `toAiSdkToolResultOutput` (in
 * `@cline/shared`) recognises as multimodal and forwards as a real image
 * to the model. See `shared/src/llms/ai-sdk-format.ts` and the `read_files`
 * image-handling path for the same convention.
 */
function toImageResult(
	result: Record<string, unknown>,
	caption: string,
): Array<
	| { type: "text"; text: string }
	| { type: "image"; data: string; mediaType: string }
> {
	const data = typeof result.data === "string" ? result.data : "";
	if (!data) {
		// Surface the failure as text so the model still gets feedback.
		return [
			{
				type: "text",
				text: `${caption} (no image data returned by daemon — payload: ${JSON.stringify(
					result,
				).slice(0, 200)})`,
			},
		];
	}
	return [
		{ type: "text", text: caption },
		{ type: "image", data, mediaType: "image/jpeg" },
	];
}
