import {
	createPluginCommandService,
	type PluginCommandResult,
	type PluginCommandService,
} from "@cline/core";
import type { SidecarContext } from "./types";

// One service per workspace; it keeps the plugin sandboxes alive between
// commands and reloads them itself when the plugin set changes.
const servicesByWorkspace = new Map<string, PluginCommandService>();

export function getPluginCommandService(
	ctx: SidecarContext,
	workspacePath: string,
): PluginCommandService {
	let service = servicesByWorkspace.get(workspacePath);
	if (!service) {
		service = createPluginCommandService({
			cwd: workspacePath,
			workspacePath,
			logger: ctx.logger,
		});
		servicesByWorkspace.set(workspacePath, service);
	}
	return service;
}

// A failed load (sandbox startup timeout, I/O hiccup) yields an empty command
// list and is cached by the service for 30s, so space retries past that
// window. Legitimately empty results make these retries a cheap no-op since
// the service keeps its loaded host.
export const WARMUP_RETRY_DELAY_MS = 35_000;
export const WARMUP_MAX_ATTEMPTS = 4;

type WarmupState = {
	attempts: number;
	done: boolean;
	inFlight: boolean;
	retry?: ReturnType<typeof setTimeout>;
};
const warmups = new Map<string, WarmupState>();

/**
 * Spawn the plugin sandbox for a workspace ahead of the first slash menu
 * open (the CLI does the same at TUI mount), so the menu lists plugin
 * commands immediately instead of paying the cold spawn on the first `/`.
 * The webview calls this for whichever workspace it has adopted. A load that
 * comes back empty is retried in the background a few times so a slow cold
 * start recovers without the user reopening the menu.
 */
export function warmPluginCommandService(
	ctx: SidecarContext,
	workspacePath: string,
): void {
	let state = warmups.get(workspacePath);
	if (!state) {
		state = { attempts: 0, done: false, inFlight: false };
		warmups.set(workspacePath, state);
	}
	if (
		state.done ||
		state.inFlight ||
		state.retry ||
		state.attempts >= WARMUP_MAX_ATTEMPTS
	) {
		return;
	}
	state.attempts += 1;
	state.inFlight = true;
	void getPluginCommandService(ctx, workspacePath)
		.listCommands()
		.then(
			(commands) => commands.length > 0,
			(error) => {
				ctx.logger?.debug?.("plugin command warmup failed", { error });
				return false;
			},
		)
		.then((loaded) => {
			state.inFlight = false;
			if (loaded) {
				state.done = true;
				return;
			}
			if (state.attempts >= WARMUP_MAX_ATTEMPTS) {
				return;
			}
			state.retry = setTimeout(() => {
				state.retry = undefined;
				warmPluginCommandService(ctx, workspacePath);
			}, WARMUP_RETRY_DELAY_MS);
			state.retry.unref?.();
		});
}

/** Test hook: forget warm-up progress and cached services. */
export function resetPluginCommandServicesForTests(): void {
	for (const state of warmups.values()) {
		clearTimeout(state.retry);
	}
	warmups.clear();
	servicesByWorkspace.clear();
}

/**
 * Run a plugin-registered slash command for the leading `/name` token of a
 * prompt. Returns undefined when no enabled plugin declares the command so
 * the prompt continues through the normal path.
 */
export async function runPluginSlashCommand(
	ctx: SidecarContext,
	input: { workspacePath: string; prompt: string },
): Promise<PluginCommandResult | undefined> {
	const match = input.prompt.match(/^\/(\S+)([\s\S]*)$/);
	if (!match?.[1]) return undefined;
	return await getPluginCommandService(ctx, input.workspacePath).run(
		match[1],
		match[2] ?? "",
	);
}
