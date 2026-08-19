/**
 * Sandboxed Hub launcher.
 *
 * Spawned by main.rs INSTEAD of the sidecar binary directly (see
 * SANDBOX.md). Wraps the ENTIRE Hub process with @anthropic-ai/sandbox-runtime's
 * OS-native sandboxing (sandbox-exec on macOS, bubblewrap on Linux), so the
 * agent has no filesystem access beyond:
 *   - its own bot's data/plugins/rules/skills, under ~/.cline/bots/<bot-id>/
 *     (see bot-config.ts) - NOT the host's shared ~/.cline, and not any
 *     other bot's tree
 *   - the workspace directory passed on the command line, if any
 *
 * Usage: bun run sandbox/launcher.ts <sidecar-binary-path> [workspace-dir]
 *
 * Verified end-to-end while building this (see SANDBOX.md): the Hub reaches
 * its normal `{"type":"ready",...}` state under a fully deny-by-default
 * filesystem policy and a domain-restricted network policy. That stdout line
 * is piped straight through unchanged, so main.rs's existing ready-line
 * parsing needs no changes at all.
 *
 * IMPORTANT: this sidecar process is not where tool execution (bash, file
 * read/write, search) actually happens - that's the SDK's own separate,
 * detached "Hub daemon" process, discovered/reused via a record keyed by
 * CLINE_DIR (bot-scoped) unless overridden. This launcher overrides that
 * discovery path per project (see CLINE_HUB_DISCOVERY_PATH below) so each
 * project forces its own daemon, which then inherits *this* sidecar's own
 * Seatbelt scope rather than reusing a differently-scoped one from another
 * project. Without that override, per-project sandboxing here would be
 * silently ineffective for actual tool execution.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	SandboxManager,
	type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import { MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms";
import {
	ensureBotHomeReady,
	installBuiltinPlugins,
	resolveBotHome,
	resolveBotProviderSettingsPath,
} from "./bot-config";

const HOME = homedir();

const [, , binaryPath, workspaceDir] = process.argv;
if (!binaryPath) {
	console.error(
		"usage: bun run sandbox/launcher.ts <sidecar-binary-path> [workspace-dir]",
	);
	process.exit(1);
}

const bot = resolveBotHome();
await ensureBotHomeReady(bot);
// Resolved here (not inside bot-config.ts, which the compiled sidecar binary
// also imports) because only this uncompiled script has a real, on-disk
// import.meta.url to resolve from - the compiled binary's import.meta.url
// points at a synthetic in-binary path instead of this repo's actual layout.
installBuiltinPlugins(bot, dirname(fileURLToPath(import.meta.url)));
const providerSettingsPath = resolveBotProviderSettingsPath(bot);
const providerSettingsDir = dirname(providerSettingsPath);

/**
 * Fallback domains for providers whose real endpoint is resolved dynamically
 * (per-account/region), so there's no fixed `baseUrl` in
 * MODEL_COLLECTIONS_BY_PROVIDER_ID to read - a wildcard is the best a static
 * allowlist can do for these. Not exhaustive (e.g. SAP AI Core's host is
 * tenant-specific with no universal wildcard); extend via
 * CLINE_SANDBOX_ALLOWED_DOMAINS for anything not covered here.
 */
const DYNAMIC_HOST_PROVIDER_DOMAINS: Record<string, string> = {
	vertex: "*.googleapis.com",
	bedrock: "*.amazonaws.com",
};

/**
 * Best-effort resolution of the configured model providers' API domains, so
 * the sandboxed Hub can actually reach them - without this the agent
 * couldn't talk to its own model at all. Reads ONLY the `provider` name and
 * `baseUrl` field from the bot's effective providers.json (bot override or
 * shared fallback); that file also holds real API keys, which are never read,
 * logged, or otherwise touched here.
 *
 * Allowlists every configured provider, not just whichever was active when
 * this process was first spawned: per-project processes are pooled and
 * never respawn on their own (see SANDBOX.md), so switching the active
 * model/provider mid-session must not get silently network-blocked by a
 * Seatbelt scope resolved before that switch happened. A provider added to
 * providers.json *after* this process spawned still needs a restart to pick
 * up - only the already-configured providers are known in advance.
 *
 * Each provider's default endpoint comes from the SDK's own provider
 * registry (MODEL_COLLECTIONS_BY_PROVIDER_ID) - the same source the actual
 * HTTP client code falls back to when the user hasn't set a custom baseUrl -
 * rather than a hand-maintained list here that would inevitably drift out of
 * sync with the real, ever-growing set of supported providers.
 */
function resolveProviderDomains(): string[] {
	const domains = new Set<string>(["api.cline.bot", "*.cline.bot"]);
	try {
		if (!existsSync(providerSettingsPath)) {
			return [...domains];
		}
		const parsed = JSON.parse(readFileSync(providerSettingsPath, "utf8")) as {
			providers?: Record<
				string,
				{ settings?: { provider?: string; baseUrl?: string } }
			>;
		};
		for (const [key, entry] of Object.entries(parsed.providers ?? {})) {
			const providerType = entry.settings?.provider || key;
			const baseUrl =
				entry.settings?.baseUrl ||
				MODEL_COLLECTIONS_BY_PROVIDER_ID[providerType]?.provider.baseUrl;
			if (baseUrl) {
				try {
					domains.add(new URL(baseUrl).hostname);
					continue;
				} catch (error) {
					console.error(
						`[sandbox-launcher] could not parse baseUrl for provider "${key}", falling back to dynamic-host domain:`,
						error,
					);
				}
			}
			if (DYNAMIC_HOST_PROVIDER_DOMAINS[providerType]) {
				domains.add(DYNAMIC_HOST_PROVIDER_DOMAINS[providerType]);
			}
		}
	} catch (error) {
		console.error(
			"[sandbox-launcher] could not resolve provider domains, using defaults only:",
			error,
		);
	}
	return [...domains];
}

/**
 * Common package/VCS registries the agent's shell-tool commands routinely
 * need (git clone, npm/pip install). This whole process is sandboxed - not
 * just individual shell commands (an earlier, narrower approach lived in
 * sidecar/sandboxed-shell.ts; see SANDBOX.md for why it was folded in here
 * instead of layered on top: a nested sandbox can only narrow what its
 * parent already allows, so keeping a second, separately-configured
 * allowlist there would have been silently ineffective unless it stayed in
 * lockstep with this one - one policy is simpler and less fragile than two
 * that must agree).
 */
const SHELL_TOOL_DOMAINS = [
	"github.com",
	"*.github.com",
	"registry.npmjs.org",
	"pypi.org",
	"files.pythonhosted.org",
];

function resolveExtraAllowedDomains(): string[] {
	const extra = process.env.CLINE_SANDBOX_ALLOWED_DOMAINS?.trim();
	return extra
		? extra
				.split(",")
				.map((domain) => domain.trim())
				.filter(Boolean)
		: [];
}

const binaryDir = dirname(binaryPath);

// The whole bot home dir (data/plugins/rules/skills - see bot-config.ts)
// is allowed as one unit, rather than allowlisting each subdirectory
// separately: they're all namespaced under the same root specifically so
// there's one thing to grant access to, not four that must be kept in sync.
// This also already covers the propose-bot plugin installBuiltinPlugins
// copies into the "cline" bot's own plugins/ dir - no separate allowRead
// entry needed for it.
//
// dirname(binaryDir) (not just binaryDir) so the sandboxed process can also
// read its sibling `extensions/` dir - the SDK's plugin-sandbox loader
// (sdk/packages/core/src/extensions/plugin/plugin-sandbox.ts,
// resolveBootstrapFromExecutable) looks for a compiled
// plugin-sandbox-bootstrap.js there specifically (next to, not inside, the
// binary's own dir). Without a real file at that exact path, a `bun build
// --compile`d sidecar has no on-disk bootstrap to fall back to at all (its
// own import.meta.url points inside the binary, not real disk) and plugin
// loading fails outright. build-sidecar-bin.ts vendors that file - plus
// jiti and @cline/shared, its own runtime dependencies - into
// src-tauri/extensions/ as part of the sidecar build, dereferencing their
// own workspace symlinks (cpSync's `dereference: true`) so every file the
// sandboxed process needs to read actually lives under this one allowed
// root rather than a relative symlink pointing back outside it.
const allowRead = [bot.homeDir, binaryDir, dirname(binaryDir)];
const allowWrite = [bot.homeDir];
if (!providerSettingsPath.startsWith(`${bot.homeDir}/`)) {
	// A bot without an override shares the host provider settings. Grant the
	// whole settings directory because providers.json uses atomic temp-file
	// renames and custom model catalogs live beside it in models.json.
	allowRead.push(providerSettingsDir);
	allowWrite.push(providerSettingsDir);
}
if (workspaceDir) {
	allowRead.push(workspaceDir);
	allowWrite.push(workspaceDir);
}

const config: SandboxRuntimeConfig = {
	network: {
		allowedDomains: [
			...resolveProviderDomains(),
			...SHELL_TOOL_DOMAINS,
			...resolveExtraAllowedDomains(),
		],
		deniedDomains: [],
		// The Hub binds its own WebSocket server locally; without this the
		// bind itself is refused (default false) and nothing can start.
		allowLocalBinding: true,
	},
	filesystem: {
		// Read is allow-everywhere by default; deny the whole home directory,
		// then re-allow just this bot's own tree, the workspace, and wherever
		// the binary itself lives (needed to execute it at all). Everything
		// else under the real home directory - including the host's own
		// shared ~/.cline, ~/Documents/Cline, and any other bot's tree - stays
		// blocked.
		denyRead: [HOME],
		allowRead,
		// Write is deny-everywhere by default; only these matter.
		allowWrite,
		denyWrite: [],
	},
};

// Falls back to the bot's own home dir, not this script's ambient
// process.cwd() - the "no project" case (empty workspaceDir) still needs a
// cwd the sandbox actually allows the child to start in, and the launcher's
// own cwd (typically the app's install/checkout directory) usually isn't
// one of the allowed paths at all.
const cwd = workspaceDir || bot.homeDir;
/**
 * The SDK's own "Hub daemon" (a separate, detached, self-relaunched process
 * - see sdk/packages/core/src/hub/daemon) is where tool execution (bash,
 * file read/write, search, etc.) actually runs, NOT this sidecar process
 * itself: this sidecar only overrides askQuestion/tool-approval in its
 * RuntimeCapabilities (see sidecar/context.ts's
 * createSidecarRuntimeCapabilities), so every other tool falls through to
 * the SDK's own built-in executors, which the daemon runs natively.
 *
 * That daemon is discovered/reused by a record keyed only by CLINE_DIR by
 * default (sdk/packages/core/src/hub/discovery) - i.e. per BOT, not per
 * project. Left alone, a second project's sidecar would silently reuse the
 * first project's already-running daemon - inheriting *that* daemon's
 * Seatbelt scope (fixed forever at its own first spawn) instead of getting
 * its own. Overriding CLINE_HUB_DISCOVERY_PATH per project forces each one
 * onto its own discovery record, so each gets its own freshly-spawned
 * daemon - which, being spawned as a plain child_process from within this
 * already-sandboxed sidecar, inherits *this* sidecar's own Seatbelt profile
 * (nested sandboxes only narrow, never widen - see SANDBOX.md) rather than
 * whatever an unrelated project's daemon happened to start with.
 */
// Bot id is part of the hash input (not just workspaceDir) because two
// different bots both in the "no project" state - which is exactly where
// every newly created bot starts, and where you land after a full app
// restart - would otherwise hash to the identical port and discovery key.
// Each bot's Hub daemon is a separate process with its own discovery record
// under its own bot.homeDir, so neither sees the other as already running;
// without the bot id here they'd both try to bind the same fixed port, and
// whichever loses fails to start its daemon at all.
const projectDiscoveryHash = createHash("sha256")
	.update(`${bot.id}:${workspaceDir || "no-project"}`)
	.digest("hex");
const projectDiscoveryKey = workspaceDir
	? projectDiscoveryHash.slice(0, 16)
	: "no-project";
const hubDiscoveryPath = join(
	bot.homeDir,
	"data",
	"locks",
	"hub",
	"projects",
	projectDiscoveryKey,
	"discovery.json",
);

/**
 * A discovery record naming a still-alive pid does NOT mean that daemon's
 * outbound network still works. Its HTTP_PROXY/HTTPS_PROXY env vars point at
 * a local proxy this app starts *inside its own launcher process* (see
 * `resolveChildCommand` below) - once that launcher exits for any reason
 * that skips the graceful sidecar shutdown which would otherwise stop this
 * daemon too (a crash, a force quit, anything besides a clean exit), the
 * daemon detaches and keeps running with those env vars now pointing at a
 * dead port. It still looks perfectly healthy to the SDK's own reuse check
 * (an alive-pid check plus a control-plane probe - both local, unproxied,
 * unaffected by a dead outbound proxy), so left alone it gets reused
 * forever, failing every outbound provider call with a raw connection
 * refusal. This launcher only ever runs when main.rs has no live child
 * tracked for this (bot, project) pair (see `BackendEntry` in main.rs), so
 * any daemon already recorded here is necessarily left over from a
 * *previous* launcher invocation - never one this run's own sidecar could
 * still need - making it always safe to evict before proceeding. That
 * guarantees whatever daemon ends up serving this session was paired with
 * the proxy *this* launcher is about to start, not a since-dead one.
 */
async function evictStaleHubDaemon(discoveryPath: string): Promise<void> {
	let pid: number | undefined;
	try {
		const record = JSON.parse(readFileSync(discoveryPath, "utf8")) as {
			pid?: unknown;
		};
		pid = typeof record.pid === "number" ? record.pid : undefined;
	} catch {
		return;
	}
	if (!pid) {
		return;
	}
	try {
		process.kill(pid, 0);
	} catch {
		return; // Already dead - nothing to evict.
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return; // Exited gracefully.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already gone by the time we got here.
	}
}
await evictStaleHubDaemon(hubDiscoveryPath);

// The daemon's own listen port has no bind-failure fallback (unlike the
// sidecar's own HTTP server, which retries on port 0) - two projects both
// defaulting to the same port would mean the second project's daemon simply
// fails to start ("No compatible hub runtime is available"). Deriving a
// distinct, deterministic port per project from the same hash avoids that;
// collisions are possible in principle but require two projects to hash
// into the same 10,000-port bucket, an acceptable tradeoff over adding a
// stateful port-allocator for what's still a first-pass design (see
// SANDBOX.md).
const projectHubPort =
	30_000 + (Number.parseInt(projectDiscoveryHash.slice(0, 8), 16) % 10_000);

// CLINE_DIR is what makes the in-process data/plugins/rules/skills loaders
// (sdk/packages/shared/src/storage/paths.ts) resolve under this bot's own
// tree instead of the host's shared ~/.cline - this must stay in lockstep
// with the sandbox's own allowRead/allowWrite above (bot.homeDir), or the
// process would be denied access to paths it's actually trying to use.
const childEnv = {
	...process.env,
	CLINE_DIR: bot.homeDir,
	CLINE_PROVIDER_SETTINGS_PATH: providerSettingsPath,
	CLINE_HUB_DISCOVERY_PATH: hubDiscoveryPath,
	CLINE_HUB_PORT: String(projectHubPort),
};

/**
 * The caller (main.rs) always spawns through this launcher rather than
 * branching on availability itself - this is the one place that decides
 * whether sandboxing is actually possible. If not, the Hub still starts
 * (unsandboxed, same as before this feature existed) rather than the app
 * failing to launch at all.
 */
async function resolveChildCommand(): Promise<{
	argv: string[];
	env: NodeJS.ProcessEnv;
}> {
	if (!SandboxManager.isSupportedPlatform()) {
		console.error(
			"[sandbox-launcher] unsupported platform, running unsandboxed",
		);
		return { argv: [binaryPath], env: childEnv };
	}
	const deps = await SandboxManager.checkDependenciesAsync();
	if (deps.errors.length > 0) {
		console.error(
			"[sandbox-launcher] required OS dependencies missing, running unsandboxed:",
			deps.errors,
		);
		return { argv: [binaryPath], env: childEnv };
	}
	await SandboxManager.initialize(config);
	const wrapped = await SandboxManager.wrapWithSandboxArgv(
		binaryPath,
		undefined,
		undefined,
		undefined,
		cwd,
	);
	return { argv: wrapped.argv, env: { ...childEnv, ...wrapped.env } };
}

const { argv, env } = await resolveChildCommand();

const child = spawn(argv[0], argv.slice(1), {
	cwd,
	env,
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => child.kill(signal));
}
