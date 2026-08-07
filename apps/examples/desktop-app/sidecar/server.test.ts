import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "./server";
import type { SidecarContext } from "./types";

function createTestServer() {
	return {
		port: 3126,
		upgrade: vi.fn(() => true),
	};
}

function createHandler(onShutdown = vi.fn()) {
	return createFetchHandler({} as SidecarContext, onShutdown);
}

function createTelemetryHandler(capture = vi.fn()) {
	return {
		handler: createFetchHandler({ telemetry: { capture } } as never),
		capture,
	};
}

const originalSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
const originalDbDataDir = process.env.CLINE_DB_DATA_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
	if (originalSessionDataDir === undefined) {
		delete process.env.CLINE_SESSION_DATA_DIR;
	} else {
		process.env.CLINE_SESSION_DATA_DIR = originalSessionDataDir;
	}
	if (originalDbDataDir === undefined) {
		delete process.env.CLINE_DB_DATA_DIR;
	} else {
		process.env.CLINE_DB_DATA_DIR = originalDbDataDir;
	}
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("sidecar HTTP origin checks", () => {
	it("rejects cross-origin shutdown preflight requests", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/shutdown", {
				method: "OPTIONS",
				headers: {
					origin: "https://attacker.example",
					"access-control-request-method": "POST",
				},
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(response?.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("rejects cross-origin shutdown POST requests", async () => {
		const onShutdown = vi.fn();
		const server = createTestServer();
		const response = await createHandler(onShutdown)(
			new Request("http://127.0.0.1:3126/shutdown", {
				method: "POST",
				headers: {
					origin: "https://attacker.example",
				},
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(onShutdown).not.toHaveBeenCalled();
	});

	it("rejects cross-origin websocket upgrades", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/transport", {
				headers: {
					origin: "https://attacker.example",
				},
			}),
			server,
		);

		expect(response?.status).toBe(404);
		expect(server.upgrade).not.toHaveBeenCalled();
	});

	it("allows desktop webview origins in preflight responses", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/api/marketplace/catalog", {
				method: "OPTIONS",
				headers: {
					origin: "tauri://localhost",
					"access-control-request-method": "GET",
				},
			}),
			server,
		);

		expect(response?.status).toBe(204);
		expect(response?.headers.get("access-control-allow-origin")).toBe(
			"tauri://localhost",
		);
	});
});

describe("session media artifacts", () => {
	it("serves a generated video only from the session artifact directory", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "desktop-video-artifact-"));
		const dbDir = mkdtempSync(join(tmpdir(), "desktop-video-db-"));
		temporaryDirectories.push(sessionsDir, dbDir);
		process.env.CLINE_SESSION_DATA_DIR = sessionsDir;
		process.env.CLINE_DB_DATA_DIR = dbDir;
		const artifactsDir = join(sessionsDir, "session-1", "artifacts");
		const dbArtifactsDir = join(dbDir, "session-1", "artifacts");
		mkdirSync(artifactsDir, { recursive: true });
		mkdirSync(dbArtifactsDir, { recursive: true });
		writeFileSync(join(artifactsDir, "video-result.mp4"), "video-bytes");
		writeFileSync(join(dbArtifactsDir, "video-result.mp4"), "database-bytes");

		const response = await createHandler()(
			new Request(
				"http://127.0.0.1:3126/api/session-artifacts/session-1/video-result.mp4",
				{ headers: { origin: "tauri://localhost" } },
			),
			createTestServer(),
		);

		expect(response?.status).toBe(200);
		expect(response?.headers.get("content-type")).toBe("video/mp4");
		await expect(response?.text()).resolves.toBe("video-bytes");
	});

	it("serves generated audio with its audio content type", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "desktop-audio-artifact-"));
		temporaryDirectories.push(sessionsDir);
		process.env.CLINE_SESSION_DATA_DIR = sessionsDir;
		const artifactsDir = join(sessionsDir, "session-1", "artifacts");
		mkdirSync(artifactsDir, { recursive: true });
		writeFileSync(join(artifactsDir, "audio-result.mp3"), "audio-bytes");

		const response = await createHandler()(
			new Request(
				"http://127.0.0.1:3126/api/session-artifacts/session-1/audio-result.mp3",
				{ headers: { origin: "tauri://localhost" } },
			),
			createTestServer(),
		);

		expect(response?.status).toBe(200);
		expect(response?.headers.get("content-type")).toBe("audio/mpeg");
		await expect(response?.text()).resolves.toBe("audio-bytes");
	});

	it("rejects untrusted origins for session artifacts", async () => {
		const response = await createHandler()(
			new Request(
				"http://127.0.0.1:3126/api/session-artifacts/session-1/video.mp4",
				{ headers: { origin: "https://attacker.example" } },
			),
			createTestServer(),
		);

		expect(response?.status).toBe(403);
	});
});

describe("desktop error telemetry", () => {
	it("captures sanitized webview error reports with structured context", async () => {
		const server = createTestServer();
		const { handler, capture } = createTelemetryHandler();
		const response = await handler(
			new Request("http://127.0.0.1:3126/telemetry/error", {
				method: "POST",
				headers: {
					origin: "tauri://localhost",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "webview.command_timeout",
					errorMessage:
						"Desktop command timed out waiting for get_process_context",
					errorType: "Error",
					command: "get_process_context",
					timeoutMs: 120_000,
					transportState: "connected",
				}),
			}),
			server,
		);

		expect(response?.status).toBe(202);
		expect(capture).toHaveBeenCalledWith({
			event: "sdk.error",
			properties: expect.objectContaining({
				component: "desktop",
				operation: "webview.command_timeout",
				error_message:
					"Desktop command timed out waiting for get_process_context",
				command: "get_process_context",
				timeoutMs: 120_000,
				transportState: "connected",
			}),
		});
	});

	it("rejects error reports from untrusted origins", async () => {
		const server = createTestServer();
		const { handler, capture } = createTelemetryHandler();
		const response = await handler(
			new Request("http://127.0.0.1:3126/telemetry/error", {
				method: "POST",
				headers: { origin: "https://attacker.example" },
				body: JSON.stringify({ operation: "webview.uncaught_error" }),
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(capture).not.toHaveBeenCalled();
	});
});
