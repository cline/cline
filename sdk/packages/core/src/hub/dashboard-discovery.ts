import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { HubOwnerContext } from "./discovery";

const DASHBOARD_DISCOVERY_FILENAME = "dashboard.json";

export interface HubDashboardDiscoveryRecord {
	pid: number;
	listenUrl: string;
	publicUrl: string;
	inviteUrl: string;
	hubUrl?: string;
	startedAt: string;
	updatedAt: string;
}

export function resolveHubDashboardDiscoveryPath(
	owner: HubOwnerContext,
): string {
	return join(dirname(owner.discoveryPath), DASHBOARD_DISCOVERY_FILENAME);
}

export function isHubDashboardPidAlive(pid: number | undefined): boolean {
	if (!Number.isInteger(pid) || !pid || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error
			? String((error as NodeJS.ErrnoException).code) === "EPERM"
			: false;
	}
}

export async function readHubDashboardDiscovery(
	discoveryPath: string,
): Promise<HubDashboardDiscoveryRecord | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(discoveryPath, "utf8"),
		) as Partial<HubDashboardDiscoveryRecord>;
		if (
			typeof parsed.pid !== "number" ||
			typeof parsed.listenUrl !== "string" ||
			typeof parsed.publicUrl !== "string" ||
			typeof parsed.inviteUrl !== "string" ||
			typeof parsed.startedAt !== "string" ||
			typeof parsed.updatedAt !== "string"
		) {
			return undefined;
		}
		return {
			pid: parsed.pid,
			listenUrl: parsed.listenUrl,
			publicUrl: parsed.publicUrl,
			inviteUrl: parsed.inviteUrl,
			hubUrl: typeof parsed.hubUrl === "string" ? parsed.hubUrl : undefined,
			startedAt: parsed.startedAt,
			updatedAt: parsed.updatedAt,
		};
	} catch {
		return undefined;
	}
}

export async function writeHubDashboardDiscovery(
	discoveryPath: string,
	record: HubDashboardDiscoveryRecord,
): Promise<void> {
	const discoveryDir = dirname(discoveryPath);
	const tempPath = join(
		discoveryDir,
		`.${basename(discoveryPath)}.${process.pid}.${Date.now()}.tmp`,
	);
	await mkdir(discoveryDir, { recursive: true });
	try {
		await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		await chmod(tempPath, 0o600);
		await rename(tempPath, discoveryPath);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

export async function clearHubDashboardDiscovery(
	discoveryPath: string,
): Promise<void> {
	await rm(discoveryPath, { force: true }).catch(() => undefined);
}
