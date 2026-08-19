/**
 * "Bot" identity resolution.
 *
 * A bot is a named agent identity with its own namespaced
 * `~/.cline/bots/<bot-id>/` directory tree - used as that process's
 * `CLINE_DIR`, so its sessions, plugins, rules, and skills are namespaced
 * under one root instead of shared with the host's own `~/.cline` (or with
 * any other bot's). This is a genuinely
 * separate identity, not a clone of the host's: a bot's tree is never seeded
 * or copied from the host's `~/.cline/data`. Provider settings are the one
 * shared fallback: a bot uses the host file until it has its own override.
 *
 * `CLINE_DIR` (see sdk/packages/shared/src/storage/paths.ts) already
 * cascades to each of those four subdirectories on its own -
 * `resolveClineDataDir()`, the plugin loader, the rules loader, and the
 * skills loader all derive their *primary* search path from it. This module
 * exists only to compute *which* root to point `CLINE_DIR` at, and to make
 * sure that root's subdirectories exist before the sandboxed Hub starts.
 *
 * Multiple bots exist side by side (up to 5, tracked in the host-owned
 * `bots/registry.json` and created/switched via the sidebar's bot switcher
 * UI - see main.rs's `create_bot`/`switch_active_bot`). This module stays
 * its own file rather than being inlined into launcher.ts precisely because
 * that registry/switcher work only needed to change here, not the sandbox
 * launcher itself - the scalability this was designed for from the start.
 *
 * Note on what this does NOT fully isolate: each loader also unconditionally
 * scans a second, hard-coded-to-the-real-home location -
 * `~/Documents/Cline/{Plugins,Rules}` and `~/.agents/{skills,AGENTS.md}` -
 * that `CLINE_DIR` has no effect on. Those stay pinned to the real host home
 * directory regardless of which bot is active. Under this sandbox's
 * deny-by-default filesystem policy that's the *correct* outcome for
 * isolation (the bot can't see them at all, rather than seeing them
 * unintentionally) - but it does mean a plugin/rule dropped in
 * `~/Documents/Cline` on the host will never reach any bot. See
 * apps/cline/SANDBOX.md.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BOT_ID = "cline";

/** Subdirectories every bot gets, matching what CLINE_DIR cascades to. */
const BOT_SUBDIRECTORIES = ["data", "plugins", "rules", "skills"];

/**
 * This app's own first-party plugins, delivered only to the default "cline"
 * bot's plugins/ dir (see installBuiltinPlugins) - never to a bot the user
 * creates. Names must match a directory under sandbox/builtin-plugins/.
 */
const BUILTIN_PLUGINS_FOR_DEFAULT_BOT = ["propose-bot"];

export interface BotHome {
	id: string;
	/** This bot's CLINE_DIR - data/plugins/rules/skills all resolve under here. */
	homeDir: string;
}

/**
 * Which bot to launch. Set via CLINE_BOT_ID, which main.rs's
 * spawn_desktop_backend_process passes to each sandboxed process based on
 * the webview's active bot (chosen through the sidebar's bot switcher).
 */
export function resolveActiveBotId(): string {
	return process.env.CLINE_BOT_ID?.trim() || DEFAULT_BOT_ID;
}

export function resolveBotHome(botId: string = resolveActiveBotId()): BotHome {
	return {
		id: botId,
		homeDir: join(homedir(), ".cline", "bots", botId),
	};
}

/**
 * Resolve the provider configuration used by a bot. A bot-local file is an
 * explicit override; until that file exists, the bot shares the host's
 * provider configuration (including the sibling models.json catalog).
 */
export function resolveBotProviderSettingsPath(bot: BotHome): string {
	const botPath = join(bot.homeDir, "data", "settings", "providers.json");
	if (existsSync(botPath)) {
		return botPath;
	}
	return join(homedir(), ".cline", "data", "settings", "providers.json");
}

/**
 * One-time setup for a bot's home directory: creates the standard
 * subdirectories if they don't already exist. Deliberately does not touch,
 * copy anything from the host's `~/.cline/data`. A bot's history starts
 * empty; provider settings and auth use the shared fallback documented in
 * resolveBotProviderSettingsPath until a bot-local providers.json exists.
 */
export async function ensureBotHomeReady(bot: BotHome): Promise<void> {
	for (const sub of BOT_SUBDIRECTORIES) {
		mkdirSync(join(bot.homeDir, sub), { recursive: true });
	}
}

/**
 * Delivers this app's own bundled plugins into the default "cline" bot's
 * plugins/ dir - a deliberate, narrow exception to "a bot's tree is never
 * seeded": that principle is about never copying arbitrary, unrelated host
 * `~/.cline/data` into a *fresh* bot identity (which would leak stale state
 * from other contexts). This is different - the app delivering its own
 * first-party, version-controlled capability to its own default bot, the
 * same way an app ships a built-in feature. No other bot ever gets this: a
 * bot the user creates keeps starting genuinely empty.
 *
 * Plugin loading for a Hub-served session only ever auto-discovers from
 * fixed, disk-based search roots (this bot's own CLINE_DIR/plugins among
 * them) - there is no supported way to hand the daemon an extra plugin path
 * over the wire per-session, so installing the file here is the only
 * mechanism that actually works, not a stylistic choice.
 *
 * Copied fresh on every launch and overwritten (not "only if missing"), so
 * an app update's improved tool description/behavior always reaches the
 * bot rather than leaving a stale copy from whenever it was first created.
 *
 * sandboxDir is passed in by the caller (sandbox/launcher.ts, an uncompiled
 * script with a real on-disk import.meta.url) rather than resolved here,
 * since this module is also imported by the compiled sidecar binary, where
 * import.meta.url resolves to a synthetic in-binary path instead of this
 * repo's actual layout.
 */
export function installBuiltinPlugins(bot: BotHome, sandboxDir: string): void {
	if (bot.id !== DEFAULT_BOT_ID) {
		return;
	}
	for (const name of BUILTIN_PLUGINS_FOR_DEFAULT_BOT) {
		cpSync(
			join(sandboxDir, "builtin-plugins", name),
			join(bot.homeDir, "plugins", name),
			{
				recursive: true,
				filter: (source) => !source.endsWith(".test.ts"),
			},
		);
	}
}
