import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { writePrivateFile } from "@cline/core/hub/pairing";
import { resolveClineDataDir } from "@cline/shared/storage";
import { resolveCliLaunchSpec } from "../utils/internal-launch";
import { cleanMachineName, sanitizeMachineName } from "./handoff";

interface RemoteHostConfig {
	enabled: boolean;
	machineName: string;
}

interface RemoteHostStatus {
	pid: number;
	startedAt: string;
	machineName: string;
}

const remoteDir = () => join(resolveClineDataDir(), "hub", "remote");
export const remoteHostConfigPath = () => join(remoteDir(), "config.json");
export const remoteHostStatusPath = () => join(remoteDir(), "status.json");

async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return undefined;
		throw error;
	}
}

function isAlive(pid: number | undefined): boolean {
	if (!pid || !Number.isSafeInteger(pid) || pid < 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function readRemoteHostStatus(): Promise<
	(RemoteHostStatus & { running: boolean; enabled: boolean }) | undefined
> {
	const [config, status] = await Promise.all([
		readJson<RemoteHostConfig>(remoteHostConfigPath()),
		readJson<RemoteHostStatus>(remoteHostStatusPath()),
	]);
	if (!config && !status) return undefined;
	return {
		pid: status?.pid ?? 0,
		startedAt: status?.startedAt ?? "",
		machineName:
			status?.machineName ??
			config?.machineName ??
			cleanMachineName(hostname()),
		running: isAlive(status?.pid),
		enabled: config?.enabled === true,
	};
}

export async function ensureRemoteHostProcess(
	input: { machineName?: string } = {},
): Promise<RemoteHostStatus> {
	const existing = await readRemoteHostStatus();
	if (existing?.running) return existing;
	const machineName = input.machineName?.trim()
		? sanitizeMachineName(input.machineName)
		: existing?.machineName || cleanMachineName(hostname());
	await writePrivateFile(
		remoteHostConfigPath(),
		`${JSON.stringify({ enabled: true, machineName } satisfies RemoteHostConfig)}\n`,
	);
	await rm(remoteHostStatusPath(), { force: true });

	const spec = resolveCliLaunchSpec({ debugRole: "connector" });
	if (!spec)
		throw new Error(
			"Could not resolve the Cline executable for remote access.",
		);
	const child = spawn(spec.launcher, spec.childArgsPrefix, {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, CLINE_REMOTE_HOST_PROCESS: "1" },
	});
	child.unref();

	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const status = await readRemoteHostStatus();
		if (status?.running) return status;
		if (child.exitCode !== null) break;
	}
	throw new Error(
		"Cline could not start remote access. Run `cline hub remote status` for details.",
	);
}

export async function disableRemoteHostProcess(): Promise<boolean> {
	const status = await readRemoteHostStatus();
	await writePrivateFile(
		remoteHostConfigPath(),
		`${JSON.stringify({
			enabled: false,
			machineName: status?.machineName ?? cleanMachineName(hostname()),
		} satisfies RemoteHostConfig)}\n`,
	);
	if (status?.running) {
		try {
			process.kill(status.pid, "SIGTERM");
		} catch {
			// It exited between the liveness check and the signal.
		}
	}
	await rm(remoteHostStatusPath(), { force: true });
	return status?.running === true;
}

export async function readRemoteHostConfig(): Promise<
	RemoteHostConfig | undefined
> {
	return await readJson<RemoteHostConfig>(remoteHostConfigPath());
}

export async function writeRemoteHostStatus(
	status: RemoteHostStatus,
): Promise<void> {
	await writePrivateFile(remoteHostStatusPath(), `${JSON.stringify(status)}\n`);
}

export async function clearRemoteHostStatus(): Promise<void> {
	await rm(remoteHostStatusPath(), { force: true });
}
