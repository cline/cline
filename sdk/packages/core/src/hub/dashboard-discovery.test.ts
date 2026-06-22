import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	isHubDashboardPidAlive,
	readHubDashboardDiscovery,
	writeHubDashboardDiscovery,
} from "./dashboard-discovery";

describe("hub dashboard discovery", () => {
	it("atomically replaces discovery records through a private temp file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-dashboard-discovery-"));
		const discoveryPath = join(dir, "dashboard.json");
		const first = {
			pid: 111,
			listenUrl: "http://127.0.0.1:8787/",
			publicUrl: "http://127.0.0.1:8787",
			inviteUrl: "http://127.0.0.1:8787",
			startedAt: "2026-06-22T20:00:00.000Z",
			updatedAt: "2026-06-22T20:00:00.000Z",
		};
		const second = {
			...first,
			pid: 222,
			updatedAt: "2026-06-22T20:00:01.000Z",
		};

		await writeHubDashboardDiscovery(discoveryPath, first);
		await writeHubDashboardDiscovery(discoveryPath, second);

		await expect(readHubDashboardDiscovery(discoveryPath)).resolves.toEqual(
			second,
		);
		expect(await readFile(discoveryPath, "utf8")).toContain('"pid": 222');
		expect(
			(await readdir(dir)).filter((entry) => entry.endsWith(".tmp")),
		).toEqual([]);
	});

	it("reports invalid dashboard pids as not alive", () => {
		expect(isHubDashboardPidAlive(undefined)).toBe(false);
		expect(isHubDashboardPidAlive(0)).toBe(false);
		expect(isHubDashboardPidAlive(-1)).toBe(false);
	});
});
