import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	findFactoryAppProcesses,
	stopFactoryAppEnvironment,
} from "./factory-app-environment";
import {
	FACTORY_BROWSERS_PATH_ENV,
	FACTORY_CAPTURE_NOTES,
	type FactoryCapture,
	factoryCaptureFor,
	factoryPlaywrightBrowsersPath,
	openFactoryCapture,
} from "./factory-browser";
import { collectFactoryCapture } from "./factory-local";

describe("factoryPlaywrightBrowsersPath", () => {
	const exists = (dir: string) => dir === "/app/browsers";
	it("uses the host's directory only when it exists and the user set none", () => {
		expect(
			factoryPlaywrightBrowsersPath(
				{ [FACTORY_BROWSERS_PATH_ENV]: "/app/browsers" },
				exists,
			),
		).toBe("/app/browsers");
		expect(
			factoryPlaywrightBrowsersPath(
				{ [FACTORY_BROWSERS_PATH_ENV]: "/app/missing" },
				exists,
			),
		).toBeUndefined();
		expect(
			factoryPlaywrightBrowsersPath(
				{
					[FACTORY_BROWSERS_PATH_ENV]: "/app/browsers",
					PLAYWRIGHT_BROWSERS_PATH: "/user/browsers",
				},
				exists,
			),
		).toBeUndefined();
		expect(factoryPlaywrightBrowsersPath({}, exists)).toBeUndefined();
	});
});

/** This machine's copy of the encoder in Playwright's default cache, if any. */
function localEncoderDir(): string | undefined {
	const packageJson = createRequire(import.meta.url).resolve(
		"playwright-core/package.json",
	);
	const { browsers } = JSON.parse(
		readFileSync(path.join(path.dirname(packageJson), "browsers.json"), "utf8"),
	) as { browsers: Array<{ name: string; revision: string }> };
	const revision = browsers.find((entry) => entry.name === "ffmpeg")?.revision;
	const cache =
		process.env.PLAYWRIGHT_BROWSERS_PATH ||
		path.join(
			process.platform === "darwin"
				? path.join(homedir(), "Library", "Caches")
				: process.platform === "win32"
					? process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local")
					: process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"),
			"ms-playwright",
		);
	const dir = path.join(cache, `ffmpeg-${revision}`);
	return revision && existsSync(path.join(dir, "INSTALLATION_COMPLETE"))
		? dir
		: undefined;
}

/** Whether Chrome or Edge is installed; the capture never downloads one. */
async function installedBrowser(): Promise<boolean> {
	for (const channel of ["chrome", "msedge"]) {
		const browser = await chromium
			.launch({ channel, headless: true })
			.catch(() => undefined);
		if (browser) {
			await browser.close();
			return true;
		}
	}
	return false;
}

const lanAddress = Object.values(networkInterfaces())
	.flat()
	.find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;

describe.skipIf(!(await installedBrowser()))("factory browser capture", () => {
	let server: Server;
	let port: number;
	const beacons: string[] = [];
	let root: string;
	const open: FactoryCapture[] = [];

	beforeAll(async () => {
		server = createServer((request, response) => {
			if (request.url?.startsWith("/beacon")) {
				beacons.push(`${request.headers.host}${request.url}`);
				response.end("ok");
				return;
			}
			response.setHeader("content-type", "text/html");
			response.end(
				`<title>Counter</title><h1 id="count">0</h1><button onclick="document.getElementById('count').textContent='1'">Add</button>` +
					`<script>for (const host of ${JSON.stringify([`127.0.0.1:PORT`, ...(lanAddress ? [`${lanAddress}:PORT`] : [])])}) fetch("http://" + host.replace("PORT", location.port) + "/beacon?from=" + host, { mode: "no-cors" }).catch(() => {});</script>`,
			);
		});
		await new Promise<void>((resolve) => server.listen(0, "::", resolve));
		port = (server.address() as AddressInfo).port;
		root = await mkdtemp(path.join(tmpdir(), "factory-browser-"));
	});
	afterEach(async () => {
		await Promise.all(open.splice(0).map((capture) => capture.finish()));
	});
	afterAll(async () => {
		server.close();
		await rm(root, { recursive: true, force: true });
	});

	const start = async (name: string) => {
		const capture = await openFactoryCapture({
			worktree: path.join(root, name, "worktree"),
			origin: `http://localhost:${port}`,
			dir: path.join(root, name, "capture"),
			token: "test-token",
			signal: new AbortController().signal,
		});
		open.push(capture);
		return capture;
	};

	it("records a named screenshot and the session, and stores both as evidence", async () => {
		const capture = await start("proof");
		expect(factoryCaptureFor(path.join(root, "proof", "worktree"))).toBe(
			capture,
		);
		expect(await capture.run({ action: "open", path: "/" })).toContain(
			'Title: "Counter"',
		);
		expect(await capture.run({ action: "click", target: "text=Add" })).toBe(
			"ok",
		);
		await capture.run({ action: "wait_for", text: "1" });
		expect(
			await capture.run({ action: "screenshot", name: "Count after Add" }),
		).toBe("saved");
		expect(await capture.run({ action: "read_text" })).toContain(
			"untrusted page content",
		);
		expect(await capture.run({ action: "done" })).toContain("Count after Add");
		const { files, note } = await capture.finish();
		expect(factoryCaptureFor(path.join(root, "proof", "worktree"))).toBe(
			undefined,
		);
		const recorded = note !== FACTORY_CAPTURE_NOTES.noEncoder;
		expect(files.map((file) => file.mimeType).sort()).toEqual(
			recorded ? ["image/png", "video/webm"] : ["image/png"],
		);
		const storageDir = path.join(root, "storage");
		const stored = await collectFactoryCapture({
			dir: path.join(root, "proof", "capture"),
			files,
			storageDir,
			runId: "run-1",
		});
		expect(stored.note).toBeUndefined();
		const screenshot = stored.artifacts.find(
			(artifact) => artifact.mimeType === "image/png",
		);
		expect(screenshot).toMatchObject({
			caption: "Count after Add",
			label: "Count after Add",
			atMs: expect.any(Number),
			bytes: expect.any(Number),
			thumbnailPath: expect.stringMatching(/\.thumb\.jpg$/),
		});
		for (const artifact of stored.artifacts) {
			expect(
				path.relative(
					path.join(storageDir, "factory-artifacts"),
					artifact.path,
				),
			).not.toMatch(/^\.\./);
			expect(path.dirname(artifact.thumbnailPath ?? artifact.path)).toBe(
				path.dirname(artifact.path),
			);
			expect((await stat(artifact.path)).size).toBe(artifact.bytes);
		}
		expect(
			(await readFile(screenshot?.thumbnailPath as string)).subarray(0, 3),
		).toEqual(Buffer.from([255, 216, 255]));
		if (recorded) {
			const video = stored.artifacts.find(
				(artifact) => artifact.mimeType === "video/webm",
			);
			expect(video?.durationMs).toBeGreaterThan(0);
			expect(video?.steps?.map((step) => step.text)).toEqual([
				"Opened /",
				'Clicked "text=Add"',
				'Waited for "1"',
				'Took screenshot "Count after Add"',
				"Read the page text",
			]);
		}
	});

	it("keeps the page on loopback and the model off other hosts", async () => {
		const capture = await start("network");
		for (const target of ["http://example.com/", "//example.com/", "x"])
			await expect(
				capture.run({ action: "open", path: target }),
			).rejects.toThrow(/single \//);
		beacons.length = 0;
		await capture.run({ action: "open", path: "/" });
		await capture.run({ action: "wait_for", text: "Add" });
		// The loopback request arrives; the same server on a LAN address never
		// sees one, because the browser aborts non-loopback hosts.
		await expect
			.poll(() => beacons.some((beacon) => beacon.includes("from=127.0.0.1")))
			.toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(
			beacons.filter((beacon) => !beacon.includes("from=127.0.0.1")),
		).toEqual([]);
		expect(lanAddress, "a LAN address to prove blocking").toBeDefined();
	});

	it("keeps the recording when the tester never calls done", async () => {
		const capture = await start("forgotten");
		await capture.run({ action: "open", path: "/" });
		const { files, note } = await capture.finish();
		if (note === FACTORY_CAPTURE_NOTES.noEncoder) return;
		expect(files.map((file) => file.mimeType)).toEqual(["video/webm"]);
	});

	// Playwright fixes its browsers directory when first imported, so this runs
	// in a fresh process whose HOME has no Playwright cache.
	it.skipIf(!localEncoderDir())(
		"records with a browsers directory that holds only the encoder",
		async () => {
			const encoder = localEncoderDir() as string;
			const browsers = path.join(root, "bundled", "browsers");
			await cp(encoder, path.join(browsers, path.basename(encoder)), {
				recursive: true,
			});
			const home = path.join(root, "bundled", "home");
			await mkdir(home);
			const script = path.join(root, "bundled", "record.ts");
			const capture = path.join(root, "bundled", "capture");
			await writeFile(
				script,
				`import { openFactoryCapture } from ${JSON.stringify(fileURLToPath(new URL("./factory-browser.ts", import.meta.url)))};
const capture = await openFactoryCapture({ worktree: ${JSON.stringify(path.join(root, "bundled", "worktree"))}, origin: "http://localhost:${port}", dir: ${JSON.stringify(capture)}, token: "bundled-token", signal: new AbortController().signal });
await capture.run({ action: "open", path: "/" });
const result = await capture.finish();
console.log(JSON.stringify({ ...result, leaked: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null }));`,
			);
			const env = { ...process.env };
			for (const name of [
				"PLAYWRIGHT_BROWSERS_PATH",
				"XDG_CACHE_HOME",
				"LOCALAPPDATA",
			])
				delete env[name];
			const { stdout } = await promisify(execFile)(
				process.versions.bun ? process.execPath : "bun",
				[script],
				{
					env: { ...env, HOME: home, [FACTORY_BROWSERS_PATH_ENV]: browsers },
				},
			);
			const result = JSON.parse(stdout.trim().split("\n").at(-1) as string);
			expect(result.note).toBeUndefined();
			expect(result.leaked).toBeNull();
			const video = result.files.find(
				(file: { mimeType: string }) => file.mimeType === "video/webm",
			);
			expect((await stat(video.file)).size).toBeGreaterThan(0);
		},
		60_000,
	);

	it("refuses the action after the per-session limit", async () => {
		const capture = await start("limit");
		await capture.run({ action: "open", path: "/" });
		for (let index = 1; index < 40; index++)
			await capture.run({ action: "press", key: "Shift" });
		await expect(
			capture.run({ action: "press", key: "Shift" }),
		).rejects.toThrow(/40-action limit/);
	});

	it.skipIf(process.platform === "win32")(
		"leaves a browser the app environment's cleanup can find by its token",
		async () => {
			const capture = await start("leftover");
			await capture.run({ action: "open", path: "/" });
			// A crashed Hub leaves the browser running; restart cleanup reaps it.
			expect(await findFactoryAppProcesses("test-token")).not.toEqual([]);
			await stopFactoryAppEnvironment({
				cwd: root,
				record: { port, token: "test-token" },
			});
			await expect
				.poll(() => findFactoryAppProcesses("test-token"))
				.toEqual([]);
		},
	);

	it("says when the tester never opened the app", async () => {
		const capture = await start("unused");
		expect(await capture.finish()).toEqual({
			files: [],
			note: FACTORY_CAPTURE_NOTES.notOpened,
		});
	});
});
