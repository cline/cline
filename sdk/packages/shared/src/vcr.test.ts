import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeAll } from "./dispose";
import type { VcrRecording } from "./types/vcr";
import { initVcr } from "./vcr";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;
const tempDirs: string[] = [];

function createTempCassettePath(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "cline-vcr-test-"));
	tempDirs.push(dir);
	return path.join(dir, "cassette.json");
}

function readCassette(filePath: string): VcrRecording[] {
	return JSON.parse(readFileSync(filePath, "utf8")) as VcrRecording[];
}

afterEach(async () => {
	await disposeAll();
	process.env = { ...ORIGINAL_ENV };
	globalThis.fetch = ORIGINAL_FETCH;
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("VCR request body contracts", () => {
	it("records sanitized request body contracts when opted in", async () => {
		const cassettePath = createTempCassettePath();
		process.env.CLINE_VCR_CASSETTE = cassettePath;
		process.env.CLINE_VCR_INCLUDE_REQUEST_BODY = "1";
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;

		initVcr("record");

		const response = await fetch("https://api.example.test/v1/chat", {
			method: "POST",
			body: JSON.stringify({
				model: "test-model",
				api_key: "secret",
				accessToken: "oauth-secret",
				z: 2,
				a: 1,
			}),
		});
		await response.text();
		await disposeAll();

		const recordings = readCassette(cassettePath);
		expect(recordings).toHaveLength(1);
		expect(recordings[0]).not.toHaveProperty("body");
		expect(recordings[0]?.requestBody).toBe(
			'{"a":1,"accessToken":"REDACTED","api_key":"REDACTED","model":"test-model","z":2}',
		);
	});

	it("matches sanitized request body contracts during playback", async () => {
		const cassettePath = createTempCassettePath();
		const recording: VcrRecording = {
			scope: "https://api.example.test",
			method: "POST",
			path: "/v1/chat",
			requestBody: '{"api_key":"REDACTED","model":"test-model"}',
			status: 200,
			response: "ok",
			responseIsBinary: false,
			contentType: "text/plain",
		};
		writeFileSync(cassettePath, JSON.stringify([recording], null, 2));
		process.env.CLINE_VCR_CASSETTE = cassettePath;

		initVcr("playback");

		const response = await fetch("https://api.example.test/v1/chat", {
			method: "POST",
			body: JSON.stringify({
				model: "test-model",
				api_key: "runtime-secret",
			}),
		});

		expect(await response.text()).toBe("ok");
	});

	it("fails playback when the sanitized request body changes", async () => {
		const cassettePath = createTempCassettePath();
		const recording: VcrRecording = {
			scope: "https://api.example.test",
			method: "POST",
			path: "/v1/chat",
			requestBody: '{"api_key":"REDACTED","model":"test-model"}',
			status: 200,
			response: "ok",
			responseIsBinary: false,
			contentType: "text/plain",
		};
		writeFileSync(cassettePath, JSON.stringify([recording], null, 2));
		process.env.CLINE_VCR_CASSETTE = cassettePath;

		initVcr("playback");

		await expect(
			fetch("https://api.example.test/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "other-model",
					api_key: "runtime-secret",
				}),
			}),
		).rejects.toThrow("Request body mismatch");
	});
});
