import { spawn, type ChildProcess } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
	GatewayClient,
	readDiscoveryRecord,
	resolveGatewayPaths,
} from "@cline/gateway/client";

const NAMESPACE = process.env.CLINE_GATEWAY_NAMESPACE?.trim() || "desktop";
const REQUIRED_GATEWAY_CAPABILITIES = ["sessions.create"] as const;

export function gatewaySpawnCwd(
	compiledSidecar: boolean,
	execPath = process.execPath,
	moduleDir = import.meta.dir,
): string {
	return compiledSidecar ? dirname(execPath) : resolve(moduleDir, "..");
}

function supportsDesktopGateway(client: GatewayClient): boolean {
	return REQUIRED_GATEWAY_CAPABILITIES.every((capability) =>
		client.hello.capabilities.includes(capability),
	);
}

async function connect(): Promise<GatewayClient | undefined> {
	const record = readDiscoveryRecord(resolveGatewayPaths({ namespace: NAMESPACE }).discoveryFile);
	if (!record) return undefined;
	try {
		return await GatewayClient.connectToDiscovery(record, {
			clientName: "cline-desktop",
			clientVersion: "0.0.1",
		});
	} catch {
		return undefined;
	}
}

async function stopIncompatibleGateway(client: GatewayClient): Promise<void> {
	try {
		await client.mutate("gateway.stop", {
			reason: "desktop app upgrade requires sessions.create",
		});
	} finally {
		client.close();
	}
	const paths = resolveGatewayPaths({ namespace: NAMESPACE });
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (!readDiscoveryRecord(paths.discoveryFile)) return;
		await Bun.sleep(50);
	}
	throw new Error("Incompatible desktop Gateway did not stop during upgrade");
}

export async function ensureGateway(): Promise<{
	client: GatewayClient;
	ownedProcess?: ChildProcess;
}> {
	const existing = await connect();
	if (existing && supportsDesktopGateway(existing)) return { client: existing };
	if (existing) await stopIncompatibleGateway(existing);

	const packaged = join(dirname(process.execPath), process.platform === "win32" ? "cline-gateway.exe" : "cline-gateway");
	const entry = resolve(import.meta.dir, "../../../sdk/packages/gateway/bin/cline-gateway.mjs");
	const compiledSidecar = basename(process.execPath).startsWith("cline-sidecar");
	if (compiledSidecar && !existsSync(packaged)) {
		throw new Error(`Bundled Gateway executable not found: ${packaged}`);
	}
	const executable = compiledSidecar ? packaged : process.execPath;
	const prefix = executable === packaged ? [] : [entry];
	const child = spawn(executable, [...prefix, "serve", "--namespace", NAMESPACE, "--lead-profile", "cline"], {
		// `import.meta.dir` points inside Bun's virtual /$bunfs filesystem in a
		// compiled executable. Passing that virtual path as posix_spawn's cwd
		// makes an otherwise-present sibling executable fail with ENOENT.
		cwd: gatewaySpawnCwd(compiledSidecar),
		env: { ...process.env, CLINE_GATEWAY_NAMESPACE: NAMESPACE },
		stdio: ["ignore", "pipe", "inherit"],
	});
	await new Promise<void>((resolveReady, reject) => {
		const timer = setTimeout(() => reject(new Error("Gateway startup timed out")), 20_000);
		child.once("exit", (code) => reject(new Error(`Gateway exited during startup (${code})`)));
		let buffer = "";
		child.stdout?.on("data", (chunk) => {
			buffer += String(chunk);
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				try {
					const ready = JSON.parse(line) as { status?: string };
					if (ready.status === "serving" || ready.status === "already_running") {
						clearTimeout(timer);
						resolveReady();
					}
				} catch { /* structured logs are not readiness */ }
			}
		});
	});
	let client: GatewayClient | undefined;
	for (let attempt = 0; attempt < 40 && !client; attempt += 1) {
		client = await connect();
		if (!client) await Bun.sleep(50);
	}
	if (!client) throw new Error("Gateway became ready but discovery connection failed");
	return { client, ownedProcess: child };
}
