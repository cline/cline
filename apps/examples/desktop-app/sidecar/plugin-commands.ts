import type { PluginCommandResult } from "@cline/core";
import { HubPluginClient, type NodeHubClient } from "@cline/core/hub";
import type { SessionRuntimeBinding, SidecarContext } from "./types";

export function getPluginCommandClient(
	binding: SessionRuntimeBinding,
): HubPluginClient {
	return new HubPluginClient(binding.hubClient);
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
	cancelled: boolean;
	inFlight: boolean;
	retry?: ReturnType<typeof setTimeout>;
};
const warmups = new Map<NodeHubClient, Map<string, WarmupState>>();

/**
 * Ask the selected Hub to prepare commands ahead of the first slash menu
 * open (the CLI does the same at TUI mount), so the menu lists plugin
 * commands immediately instead of paying the cold spawn on the first `/`.
 * The webview calls this for whichever workspace it has adopted. A load that
 * comes back empty is retried in the background a few times so a slow cold
 * start recovers without the user reopening the menu.
 */
export function warmPluginCommandService(
	ctx: SidecarContext,
	workspacePath: string,
	binding: SessionRuntimeBinding,
): void {
	let workspaces = warmups.get(binding.hubClient);
	if (!workspaces) {
		workspaces = new Map();
		warmups.set(binding.hubClient, workspaces);
	}
	let state = workspaces.get(workspacePath);
	if (!state) {
		state = { attempts: 0, done: false, cancelled: false, inFlight: false };
		workspaces.set(workspacePath, state);
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
	void getPluginCommandClient(binding)
		.listCommands(workspacePath)
		.then(
			(commands) => commands.length > 0,
			(error) => {
				ctx.logger?.debug?.("plugin command warmup failed", { error });
				return false;
			},
		)
		.then((loaded) => {
			if (state.cancelled) return;
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
				warmPluginCommandService(ctx, workspacePath, binding);
			}, WARMUP_RETRY_DELAY_MS);
			state.retry.unref?.();
		});
}

/** Cancel client warmup retries when Desktop disconnects; the Hub owns sandboxes. */
export function disposePluginCommandWarmups(
	clients?: Iterable<NodeHubClient>,
): void {
	for (const client of clients ?? warmups.keys()) {
		for (const state of warmups.get(client)?.values() ?? []) {
			state.cancelled = true;
			clearTimeout(state.retry);
		}
		warmups.delete(client);
	}
}

/**
 * Run a plugin-registered slash command for the leading `/name` token of a
 * prompt. Returns undefined when no enabled plugin declares the command so
 * the prompt continues through the normal path.
 */
export async function runPluginSlashCommand(input: {
	workspacePath: string;
	prompt: string;
	binding: SessionRuntimeBinding;
}): Promise<PluginCommandResult | undefined> {
	const match = input.prompt.match(/^\/(\S+)([\s\S]*)$/);
	if (!match?.[1]) return undefined;
	return await getPluginCommandClient(input.binding).runCommand(
		input.workspacePath,
		match[1],
		match[2] ?? "",
	);
}
