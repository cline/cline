import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * What Factory settings > Connections shows: whether the GitHub CLI is
 * installed and signed in, whether Linear issue import is configured, and
 * the Hub's state. Read only; never calls a model provider and never
 * returns a token (only host names, the login and versions).
 */
export interface FactoryConnections {
	gh: {
		installed: boolean;
		/** "2.62.0". */
		version?: string;
		/** Where `gh` was found on PATH. */
		path?: string;
		/** Hosts `gh auth status` reports; empty when signed in nowhere. */
		hosts: Array<{ host: string; login?: string; signedIn: boolean }>;
		/** The probe itself failed (timeout, unreadable output). */
		error?: string;
	};
	/** LINEAR_API_KEY or LINEAR_ACCESS_TOKEN is set for the app (value never read out). */
	linear: { configured: boolean };
	hub: {
		status: "connected" | "disconnected";
		url?: string;
		/** The app's version; a running Hub of another build reports `mismatch`. */
		appVersion?: string;
		error?: string;
		mismatch?: { hubCoreVersion?: string; reason?: string };
	};
	checkedAt: string;
}

/** Runs a command; resolves with its exit code and output, never rejects. */
export type FactoryProbeRunner = (
	file: string,
	args: string[],
) => Promise<{ code: number | "ENOENT" | "TIMEOUT"; output: string }>;

const PROBE_TIMEOUT_MS = 5_000;
const OUTPUT_MAX = 16_000;
/** How long one check is reused unless the person asks to check again. */
export const FACTORY_CONNECTIONS_CACHE_MS = 5 * 60_000;

/** gh with prompts, colour and update checks off. */
export const runFactoryProbe: FactoryProbeRunner = (file, args) =>
	new Promise((resolve) => {
		execFile(
			file,
			args,
			{
				timeout: PROBE_TIMEOUT_MS,
				maxBuffer: 256 * 1024,
				encoding: "utf8",
				env: {
					...process.env,
					GH_PROMPT_DISABLED: "1",
					GH_NO_UPDATE_NOTIFIER: "1",
					NO_COLOR: "1",
					CLICOLOR: "0",
				},
			},
			(error, stdout, stderr) => {
				const output = `${stdout ?? ""}\n${stderr ?? ""}`.slice(0, OUTPUT_MAX);
				if (!error) return resolve({ code: 0, output });
				const failure = error as NodeJS.ErrnoException & {
					killed?: boolean;
					code?: unknown;
				};
				if (failure.code === "ENOENT")
					return resolve({ code: "ENOENT", output: "" });
				if (failure.killed) return resolve({ code: "TIMEOUT", output });
				resolve({
					code: typeof failure.code === "number" ? failure.code : 1,
					output,
				});
			},
		);
	});

/** The first `gh` on PATH, without running anything. */
export function findOnPath(
	command: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const extensions =
		process.platform === "win32"
			? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
			: [""];
	for (const dir of (env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const extension of extensions) {
			const candidate = join(dir, `${command}${extension}`);
			try {
				accessSync(candidate, constants.X_OK);
				return candidate;
			} catch {
				// Not here.
			}
		}
	}
	return undefined;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes
const ANSI_COLOR = /\u001b\[[0-9;]*m/g;
const HOST = /^([a-z0-9][a-z0-9.-]*[a-z0-9](?::\d+)?)\s*$/i;
const ACCOUNT =
	/(?:✓|X|✗|×)?\s*(Logged in|Failed to log in) to (\S+?)(?: account| as) ([A-Za-z0-9-]+)/;

/**
 * Hosts and logins from `gh auth status` text (old and new formats). Only
 * host names, logins and whether the login works are read; every other
 * line, including masked token lines, is ignored.
 */
export function parseGhAuthStatus(
	output: string,
): FactoryConnections["gh"]["hosts"] {
	const hosts = new Map<string, { login?: string; signedIn: boolean }>();
	let current: string | undefined;
	for (const raw of output.split(/\r?\n/)) {
		// Colour codes, should NO_COLOR be ignored.
		const line = raw.replace(ANSI_COLOR, "");
		const host = HOST.exec(line);
		if (host && !/^\s/.test(line)) {
			current = host[1]?.toLowerCase();
			continue;
		}
		const account = ACCOUNT.exec(line);
		if (!account) continue;
		const name = (account[2] ?? current ?? "").toLowerCase();
		if (!name) continue;
		const signedIn = account[1] === "Logged in";
		const previous = hosts.get(name);
		// The first working login on a host is the one shown.
		if (!previous || (!previous.signedIn && signedIn))
			hosts.set(name, { login: account[3], signedIn });
	}
	return [...hosts].slice(0, 10).map(([host, value]) => ({ host, ...value }));
}

/** `gh` presence, version and sign-in, each probe bounded by a short timeout. */
export async function probeGitHubCli(
	run: FactoryProbeRunner = runFactoryProbe,
	env: NodeJS.ProcessEnv = process.env,
): Promise<FactoryConnections["gh"]> {
	const version = await run("gh", ["--version"]);
	if (version.code === "ENOENT") return { installed: false, hosts: [] };
	const path = findOnPath("gh", env);
	const parsedVersion = /gh version (\d+\.\d+\.\d+)/.exec(version.output)?.[1];
	const base = {
		installed: true,
		...(parsedVersion ? { version: parsedVersion } : {}),
		...(path ? { path } : {}),
	};
	if (version.code === "TIMEOUT")
		return { ...base, hosts: [], error: "gh did not answer in time" };
	const status = await run("gh", ["auth", "status"]);
	if (status.code === "TIMEOUT")
		return {
			...base,
			hosts: [],
			error: "gh auth status did not answer in time",
		};
	return { ...base, hosts: parseGhAuthStatus(status.output) };
}

/** Whether Linear issue import has a credential (the value is never read out). */
export function linearConfigured(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return Boolean(env.LINEAR_API_KEY?.trim() || env.LINEAR_ACCESS_TOKEN?.trim());
}

/**
 * The connections, reused for FACTORY_CONNECTIONS_CACHE_MS unless `refresh`.
 * The Hub's state is always read fresh (it is in memory).
 */
export function createFactoryConnectionsReader(options: {
	run?: FactoryProbeRunner;
	env?: NodeJS.ProcessEnv;
	now?: () => number;
}) {
	let cached: { at: number; gh: FactoryConnections["gh"] } | undefined;
	let probe: Promise<FactoryConnections["gh"]> | undefined;
	const now = options.now ?? Date.now;
	return async function readFactoryConnections(input: {
		refresh?: boolean;
		hub: FactoryConnections["hub"];
	}): Promise<FactoryConnections> {
		const env = options.env ?? process.env;
		let gh: FactoryConnections["gh"];
		if (
			!input.refresh &&
			cached &&
			now() - cached.at < FACTORY_CONNECTIONS_CACHE_MS
		)
			gh = cached.gh;
		else {
			probe ??= probeGitHubCli(options.run, env).finally(() => {
				probe = undefined;
			});
			gh = await probe;
			cached = { at: now(), gh };
		}
		return {
			gh,
			linear: { configured: linearConfigured(env) },
			hub: input.hub,
			checkedAt: new Date(cached?.at ?? now()).toISOString(),
		};
	};
}
