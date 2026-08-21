/**
 * Gateway CLI (Gateway RFC, Phase 3; ADR 0002).
 *
 * Explicit lifecycle modes replace client-driven daemon replacement:
 *
 * - `serve`    run the authority in the foreground
 * - `start`    ensure an authority is running (spawn detached, wait ready)
 * - `status`   read discovery, connect, report `gateway.status`
 * - `drain`    refuse new mutating work while runs finish
 * - `upgrade`  drain, wait idle, stop, start a fresh process
 * - `stop`     graceful stop
 *
 * A second `serve` against a held lock connects and diagnoses the live
 * authority (exit code 3) — it never kills it and never binds another
 * port. Clients never retire the authority; these operator commands do.
 */

import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { GatewayClient, GatewayRequestError } from "./client";
import { type DiscoveryRecord, readDiscoveryRecord } from "./discovery";
import { createConfiguredEnginePort } from "./engine-binding";
import { loadBundledLeadProfile } from "./lead-profiles";
import { GatewayLockHeldError } from "./lock";
import { resolveGatewayPaths } from "./paths";
import { readSecretFile, writeSecretFile } from "./secrets";
import { GatewayServer } from "./server";

export const GATEWAY_CLI_COMMANDS = [
	"serve",
	"start",
	"status",
	"drain",
	"upgrade",
	"stop",
	"secret-put",
] as const;

export type GatewayCliCommand = (typeof GATEWAY_CLI_COMMANDS)[number];

export interface GatewayCliIo {
	out(line: string): void;
	err(line: string): void;
}

const DEFAULT_IO: GatewayCliIo = {
	out: (line) => console.log(line),
	err: (line) => console.error(line),
};

interface ParsedArgs {
	command: GatewayCliCommand;
	/** Positional argument (`secret-put <providerId>`). */
	subject?: string;
	dataRoot?: string;
	namespace?: string;
	port?: number;
	reason?: string;
	leadProfile?: string;
	remoteHost?: string;
	remotePort?: number;
	remoteTokenName?: string;
	tlsCert?: string;
	tlsKey?: string;
	allowInsecureRemote?: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const [command, ...rest] = argv;
	if (!GATEWAY_CLI_COMMANDS.includes(command as GatewayCliCommand)) {
		throw new Error(
			`Usage: clinegate <${GATEWAY_CLI_COMMANDS.join("|")}> ` +
				"[--data-root <dir>] [--namespace <name>] [--port <n>] [--reason <text>]\n" +
				"       clinegate serve [--lead-profile <cline|cline-dad>]\n" +
				"       clinegate secret-put <name>   (reads the secret from stdin)\n" +
				"       Remote: --remote-port <n> [--remote-host <host>] [--remote-token <secret-name>]\n" +
				"               [--tls-cert <file> --tls-key <file> | --allow-insecure-remote]",
		);
	}
	const parsed: ParsedArgs = { command: command as GatewayCliCommand };
	for (let index = 0; index < rest.length; index += 1) {
		const flag = rest[index];
		if (!flag.startsWith("--")) {
			if (parsed.subject !== undefined) {
				throw new Error(`Unexpected argument: ${flag}`);
			}
			parsed.subject = flag;
			continue;
		}
		const value = rest[index + 1];
		switch (flag) {
			case "--data-root":
				parsed.dataRoot = value;
				index += 1;
				break;
			case "--namespace":
				parsed.namespace = value;
				index += 1;
				break;
			case "--port":
				parsed.port = Number(value);
				index += 1;
				break;
			case "--reason":
				parsed.reason = value;
				index += 1;
				break;
			case "--lead-profile":
				parsed.leadProfile = value;
				index += 1;
				break;
			case "--remote-host":
				parsed.remoteHost = value;
				index += 1;
				break;
			case "--remote-port":
				parsed.remotePort = Number(value);
				index += 1;
				break;
			case "--remote-token":
				parsed.remoteTokenName = value;
				index += 1;
				break;
			case "--tls-cert":
				parsed.tlsCert = value;
				index += 1;
				break;
			case "--tls-key":
				parsed.tlsKey = value;
				index += 1;
				break;
			case "--allow-insecure-remote":
				parsed.allowInsecureRemote = true;
				break;
			default:
				throw new Error(`Unknown flag: ${flag}`);
		}
	}
	return parsed;
}

async function connectTo(
	record: DiscoveryRecord,
	name = "clinegate-cli",
): Promise<GatewayClient> {
	return GatewayClient.connectToDiscovery(record, {
		clientName: name,
		clientVersion: "phase-3",
	});
}

/** Read discovery and probe the endpoint. */
async function probe(
	args: ParsedArgs,
): Promise<
	| { state: "not_running" }
	| { state: "unreachable"; record: DiscoveryRecord }
	| { state: "running"; record: DiscoveryRecord; status: unknown }
> {
	const paths = resolveGatewayPaths(args);
	const record = readDiscoveryRecord(paths.discoveryFile);
	if (!record) {
		return { state: "not_running" };
	}
	try {
		const client = await connectTo(record);
		try {
			const status = await client.request("gateway.status");
			return { state: "running", record, status };
		} finally {
			client.close();
		}
	} catch {
		return { state: "unreachable", record };
	}
}

async function commandServe(
	args: ParsedArgs,
	io: GatewayCliIo,
): Promise<number> {
	let server: GatewayServer;
	let serverRef: GatewayServer | undefined;
	const paths = resolveGatewayPaths(args);
	const remote = remoteOptions(args, paths);
	const profileId =
		args.leadProfile ??
		process.env.CLINE_GATEWAY_LEAD_PROFILE?.trim() ??
		"cline";
	const leadProfile = loadBundledLeadProfile(profileId, {
		ADMIN_NAME: process.env.ADMIN_NAME,
		ADMIN_FULL_NAME: process.env.ADMIN_FULL_NAME,
		CLINE_HOME: process.env.CLINE_HOME,
		PUBLIC_HOST: process.env.PUBLIC_HOST ?? process.env.CLINE_PUBLIC_HOST,
	});
	try {
		server = await GatewayServer.start({
			dataRoot: args.dataRoot,
			namespace: args.namespace,
			port: args.port,
			remote,
			leadProfile,
			// The approvals broker lives on the runtime, which exists only
			// after start; the getter closes over the server reference.
			// Provider credentials come from the data directory's mode-0600
			// secret files; env vars remain a local/dev override.
			engine: createConfiguredEnginePort({
				approvals: () => serverRef?.runtime.approvals,
				paths,
				// Gateway-owned tools, including constrained proactive connector
				// messaging, are late-bound after the server is constructed.
				tools: (invocation) => serverRef?.connectorTools(invocation),
				leadProfile,
			}),
		});
		serverRef = server;
	} catch (error) {
		if (error instanceof GatewayLockHeldError) {
			// Diagnose the live authority; never replace it.
			const probed = await probe(args);
			io.out(
				JSON.stringify({
					status: "already_running",
					diagnosis:
						probed.state === "running"
							? probed.status
							: {
									state: probed.state,
									discovery: "record" in probed ? probed.record : undefined,
								},
				}),
			);
			return 3;
		}
		throw error;
	}
	io.out(
		JSON.stringify({
			status: "serving",
			gatewayId: server.discovery?.gatewayId,
			instanceId: server.instanceId,
			host: server.discovery?.host,
			port: server.discovery?.port,
			remote: server.remoteAddress(),
			pid: process.pid,
			dataDir: server.paths.dataDir,
			namespace: server.paths.namespace,
		}),
	);
	const shutdown = (signal: string) => {
		io.err(`Received ${signal}; stopping gracefully`);
		void server.stop("graceful");
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	// Serve until stopped (gateway.stop, a signal, or an operator command).
	await server.whenStopped;
	return 0;
}

async function commandStart(
	args: ParsedArgs,
	io: GatewayCliIo,
): Promise<number> {
	const existing = await probe(args);
	if (existing.state === "running") {
		io.out(
			JSON.stringify({
				status: "already_running",
				...statusSummary(existing.status),
			}),
		);
		return 0;
	}
	const serveArgs = ["serve"];
	if (args.dataRoot) {
		serveArgs.push("--data-root", args.dataRoot);
	}
	if (args.namespace) {
		serveArgs.push("--namespace", args.namespace);
	}
	if (args.port !== undefined) {
		serveArgs.push("--port", String(args.port));
	}
	if (args.leadProfile) {
		serveArgs.push("--lead-profile", args.leadProfile);
	}
	if (args.remotePort !== undefined) {
		serveArgs.push("--remote-port", String(args.remotePort));
		if (args.remoteHost) serveArgs.push("--remote-host", args.remoteHost);
		if (args.remoteTokenName)
			serveArgs.push("--remote-token", args.remoteTokenName);
		if (args.tlsCert) serveArgs.push("--tls-cert", args.tlsCert);
		if (args.tlsKey) serveArgs.push("--tls-key", args.tlsKey);
		if (args.allowInsecureRemote) serveArgs.push("--allow-insecure-remote");
	}
	// Re-invoke the same entrypoint (works from source under Bun and from
	// the packaged bin under Node).
	const child = spawn(process.execPath, [process.argv[1], ...serveArgs], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const probed = await probe(args);
		if (probed.state === "running") {
			io.out(
				JSON.stringify({ status: "started", ...statusSummary(probed.status) }),
			);
			return 0;
		}
		await sleep(150);
	}
	io.err(JSON.stringify({ status: "start_timeout" }));
	return 1;
}

function remoteOptions(
	args: ParsedArgs,
	paths: ReturnType<typeof resolveGatewayPaths>,
) {
	if (args.remotePort === undefined) return undefined;
	if (
		!Number.isInteger(args.remotePort) ||
		args.remotePort < 0 ||
		args.remotePort > 65_535
	) {
		throw new Error("--remote-port must be an integer from 0 to 65535");
	}
	if (Boolean(args.tlsCert) !== Boolean(args.tlsKey)) {
		throw new Error("--tls-cert and --tls-key must be provided together");
	}
	const tokenName = args.remoteTokenName ?? "remote-access";
	const accessToken = readSecretFile(paths, tokenName)?.trim();
	if (!accessToken) {
		throw new Error(
			`Missing remote access token; pipe one to: clinegate secret-put ${tokenName}`,
		);
	}
	return {
		host: args.remoteHost ?? "127.0.0.1",
		port: args.remotePort,
		accessToken,
		allowInsecure: args.allowInsecureRemote,
		...(args.tlsCert && args.tlsKey
			? {
					tls: {
						cert: readFileSync(args.tlsCert),
						key: readOwnerOnlyFile(args.tlsKey),
					},
				}
			: {}),
	};
}

function readOwnerOnlyFile(file: string): Buffer {
	const stat = statSync(file);
	if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
		throw new Error(
			`TLS key ${file} is not owner-only (mode ${(stat.mode & 0o777).toString(8)}); refusing to read it`,
		);
	}
	return readFileSync(file);
}

function statusSummary(status: unknown): Record<string, unknown> {
	return typeof status === "object" && status !== null
		? (status as Record<string, unknown>)
		: {};
}

async function commandStatus(
	args: ParsedArgs,
	io: GatewayCliIo,
): Promise<number> {
	const probed = await probe(args);
	if (probed.state === "running") {
		io.out(
			JSON.stringify({ status: "running", ...statusSummary(probed.status) }),
		);
		return 0;
	}
	if (probed.state === "unreachable") {
		io.out(
			JSON.stringify({
				status: "unreachable",
				discovery: probed.record,
				hint: "Stale discovery record: the recorded instance is not answering. The OS lock decides authority; a new `serve` may take over safely.",
			}),
		);
		return 2;
	}
	io.out(JSON.stringify({ status: "not_running" }));
	return 1;
}

async function commandAdmin(
	args: ParsedArgs,
	io: GatewayCliIo,
	method: "gateway.drain" | "gateway.stop",
): Promise<number> {
	const probed = await probe(args);
	if (probed.state !== "running") {
		io.out(JSON.stringify({ status: probed.state }));
		return probed.state === "not_running" ? 1 : 2;
	}
	const client = await connectTo(probed.record);
	try {
		const result = await client.mutate(method, {
			...(args.reason ? { reason: args.reason } : {}),
		});
		io.out(JSON.stringify({ status: "ok", result }));
	} catch (error) {
		if (error instanceof GatewayRequestError) {
			io.err(JSON.stringify({ status: "error", error: error.gatewayError }));
			return 1;
		}
		throw error;
	} finally {
		client.close();
	}
	if (method === "gateway.stop") {
		// Wait for the instance to actually go away.
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const now = await probe(args);
			if (
				now.state === "not_running" ||
				(now.state === "running" &&
					now.record.instanceId !== probed.record.instanceId)
			) {
				return 0;
			}
			if (now.state === "unreachable") {
				return 0;
			}
			await sleep(150);
		}
		io.err(JSON.stringify({ status: "stop_timeout" }));
		return 1;
	}
	return 0;
}

async function commandUpgrade(
	args: ParsedArgs,
	io: GatewayCliIo,
): Promise<number> {
	const probed = await probe(args);
	if (probed.state !== "running") {
		io.out(
			JSON.stringify({
				status: probed.state,
				hint: "Nothing to upgrade; use start",
			}),
		);
		return probed.state === "not_running" ? 1 : 2;
	}
	// 1. Drain: no new mutating work.
	const drainExit = await commandAdmin(args, io, "gateway.drain");
	if (drainExit !== 0) {
		return drainExit;
	}
	// 2. Wait until active/queued runs settle (bounded).
	const idleDeadline = Date.now() + 60_000;
	for (;;) {
		const now = await probe(args);
		if (now.state !== "running") {
			break;
		}
		const counts = (statusSummary(now.status).counts ?? {}) as Record<
			string,
			unknown
		>;
		if (
			Number(counts.queuedRuns ?? 0) === 0 &&
			Number(counts.runningRuns ?? 0) === 0
		) {
			break;
		}
		if (Date.now() > idleDeadline) {
			io.err(JSON.stringify({ status: "upgrade_timeout_waiting_idle" }));
			return 1;
		}
		await sleep(250);
	}
	// 3. Stop the old instance, 4. start a fresh one.
	const stopExit = await commandAdmin(args, io, "gateway.stop");
	if (stopExit !== 0) {
		return stopExit;
	}
	return commandStart(args, io);
}

/**
 * Store a provider credential as an owner-only mode-0600 secret file.
 * The value is read from stdin and is never echoed, logged, audited, or
 * persisted anywhere but the secret file itself.
 */
async function commandSecretPut(
	args: ParsedArgs,
	io: GatewayCliIo,
): Promise<number> {
	const providerId = args.subject;
	if (!providerId) {
		io.err(
			"Usage: clinegate secret-put <providerId>   (reads the secret from stdin)",
		);
		return 64;
	}
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.from(chunk));
	}
	// Strip exactly one trailing newline (echo/heredoc convenience).
	const value = Buffer.concat(chunks)
		.toString("utf8")
		.replace(/\r?\n$/, "");
	if (!value) {
		io.err(JSON.stringify({ status: "error", error: "Empty secret on stdin" }));
		return 65;
	}
	const paths = resolveGatewayPaths(args);
	const file = writeSecretFile(paths, providerId, value);
	io.out(JSON.stringify({ status: "ok", provider: providerId, file }));
	return 0;
}

/** Entry point. Returns the process exit code. */
export async function runGatewayCli(
	argv: readonly string[],
	io: GatewayCliIo = DEFAULT_IO,
): Promise<number> {
	let args: ParsedArgs;
	try {
		args = parseArgs(argv);
	} catch (error) {
		io.err(error instanceof Error ? error.message : String(error));
		return 64;
	}
	switch (args.command) {
		case "serve":
			return commandServe(args, io);
		case "start":
			return commandStart(args, io);
		case "status":
			return commandStatus(args, io);
		case "drain":
			return commandAdmin(args, io, "gateway.drain");
		case "stop":
			return commandAdmin(args, io, "gateway.stop");
		case "upgrade":
			return commandUpgrade(args, io);
		case "secret-put":
			return commandSecretPut(args, io);
	}
}

// Direct execution (`bun src/cli.ts serve ...`); the packaged bin calls
// `runGatewayCli` explicitly. (`import.meta.main` is set under Bun; under
// Node the packaged bin is the entrypoint instead.)
if ((import.meta as { main?: boolean }).main) {
	runGatewayCli(process.argv.slice(2)).then(
		(code) => {
			if (code !== 0) {
				process.exit(code);
			}
		},
		(error) => {
			console.error(error);
			process.exit(70);
		},
	);
}
