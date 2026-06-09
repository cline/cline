import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	clearHubDiscovery,
	probeHubServer,
	readHubDiscovery,
	resolveHubOwnerContext,
	writeHubDiscovery,
} from ".";

type EnvSnapshot = {
	CLINE_DATA_DIR: string | undefined;
	CLINE_HUB_DISCOVERY_PATH: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_HUB_DISCOVERY_PATH: process.env.CLINE_HUB_DISCOVERY_PATH,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_HUB_DISCOVERY_PATH = snapshot.CLINE_HUB_DISCOVERY_PATH;
}

describe("hub discovery", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("stores shared hub discovery under the locks directory by default", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveHubOwnerContext("shared").discoveryPath).toBe(
			join(
				"/tmp/cline-data",
				"locks",
				"hub",
				"owners",
				"hub-a4d26868017c.json",
			),
		);
	});

	it("honors an explicit hub discovery path override", () => {
		snapshot = captureEnv();
		process.env.CLINE_HUB_DISCOVERY_PATH = "/tmp/custom-hub-discovery.json";

		expect(resolveHubOwnerContext("shared").discoveryPath).toBe(
			"/tmp/custom-hub-discovery.json",
		);
	});

	it("writes and clears discovery records at the resolved location", async () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		const discoveryPath = resolveHubOwnerContext("shared").discoveryPath;
		const record = {
			hubId: "hub_123",
			protocolVersion: "v1",
			authToken: "test-token",
			host: "127.0.0.1",
			port: 25463,
			url: "ws://127.0.0.1:25463/hub",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await mkdir(dirname(discoveryPath), { recursive: true });
		await writeFile(discoveryPath, "{}\n", "utf8");
		await chmod(discoveryPath, 0o644);
		await writeHubDiscovery(discoveryPath, record);
		await expect(readHubDiscovery(discoveryPath)).resolves.toMatchObject(
			record,
		);
		// Windows does not support Unix file permissions; chmod is a no-op there.
		if (process.platform !== "win32") {
			expect((await stat(discoveryPath)).mode & 0o777).toBe(0o600);
		}
		await clearHubDiscovery(discoveryPath);
		await expect(readHubDiscovery(discoveryPath)).resolves.toBeUndefined();
	});

	it("returns only public health fields for unauthenticated probes", async () => {
		const fetchMock = async () =>
			({
				ok: true,
				json: async () => ({
					ok: true,
					protocolVersion: "v1",
					minClientProtocolVersion: "v1",
					maxClientProtocolVersion: "v1",
					coreVersion: "1.0.0",
					host: "127.0.0.1",
					port: 25463,
					url: "ws://127.0.0.1:25463/hub",
				}),
			}) as Response;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as typeof fetch;
		try {
			const record = await probeHubServer("ws://127.0.0.1:25463/hub");

			expect(record).toMatchObject({
				protocolVersion: "v1",
				host: "127.0.0.1",
				port: 25463,
				url: "ws://127.0.0.1:25463/hub",
			});
			expect(record?.hubId).toBeUndefined();
			expect(record?.startedAt).toBeUndefined();
			expect(record?.updatedAt).toBeUndefined();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
