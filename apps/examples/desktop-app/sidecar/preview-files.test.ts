import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { derivePreviewToken } from "./preview-files";
import { createFetchHandler } from "./server";
import type { SidecarContext } from "./types";

const APPROVAL_TOKEN = "approval-token";
const TOKEN = derivePreviewToken(APPROVAL_TOKEN);
let base: string;
let workspace: string;
let outside: string;
let handler: ReturnType<typeof createFetchHandler>;

function previewRequest(filePath: string, token = TOKEN, method = "GET") {
	const encoded = filePath.split("/").map(encodeURIComponent).join("/");
	return handler(
		new Request(`http://127.0.0.1:3126/preview-file/${token}${encoded}`, {
			method,
		}),
		{ port: 3126, upgrade: () => false },
	);
}

beforeAll(async () => {
	base = await mkdtemp(path.join(tmpdir(), "preview-files-"));
	workspace = path.join(base, "workspace");
	outside = path.join(base, "outside");
	await mkdir(workspace);
	await mkdir(outside);
	await writeFile(path.join(workspace, "snake.html"), "<h1>snake</h1>");
	await writeFile(path.join(workspace, "my game.html"), "<p>spaces</p>");
	await writeFile(path.join(outside, "secret.txt"), "secret");
	await symlink(outside, path.join(workspace, "escape"));
	await symlink(
		path.join(outside, "secret.txt"),
		path.join(workspace, "secret-link.txt"),
	);
	handler = createFetchHandler({} as SidecarContext, undefined, APPROVAL_TOKEN);
});

afterAll(async () => {
	await rm(base, { recursive: true, force: true });
});

describe("sidecar /preview-file route", () => {
	it("serves a workspace file with a sandboxing CSP", async () => {
		const response = await previewRequest(path.join(workspace, "snake.html"));
		expect(response?.status).toBe(200);
		expect(response?.headers.get("content-type")).toContain("text/html");
		expect(response?.headers.get("content-security-policy")).toContain(
			"sandbox",
		);
		// Module scripts and fetches from the opaque-origin page need CORS.
		expect(response?.headers.get("access-control-allow-origin")).toBe("*");
		expect(await response?.text()).toBe("<h1>snake</h1>");
	});

	it("serves paths containing spaces", async () => {
		const response = await previewRequest(path.join(workspace, "my game.html"));
		expect(response?.status).toBe(200);
	});

	it("rejects a wrong or missing token", async () => {
		const file = path.join(workspace, "snake.html");
		expect((await previewRequest(file, "nope"))?.status).toBe(403);
		// The page can read the token in its address, so it must not be the
		// approval token.
		expect((await previewRequest(file, APPROVAL_TOKEN))?.status).toBe(403);
		const noToken = await handler(
			new Request(`http://127.0.0.1:3126/preview-file${file}`),
			{ port: 3126, upgrade: () => false },
		);
		expect(noToken?.status).toBe(403);
	});

	it("rejects non-GET methods", async () => {
		const response = await previewRequest(
			path.join(workspace, "snake.html"),
			TOKEN,
			"POST",
		);
		expect(response?.status).toBe(403);
	});

	it("serves files anywhere on this machine, following symlinks", async () => {
		for (const target of [
			path.join(outside, "secret.txt"),
			path.join(workspace, "escape", "secret.txt"),
			path.join(workspace, "secret-link.txt"),
			`${workspace}/../outside/secret.txt`,
		]) {
			const response = await previewRequest(target);
			expect(response?.status).toBe(200);
			expect(await response?.text()).toBe("secret");
		}
	});

	it.each([
		["a directory", () => workspace],
		["a missing file", () => path.join(workspace, "missing.html")],
	])("returns a readable 404 for %s", async (_label, target) => {
		const response = await previewRequest(target());
		expect(response?.status).toBe(404);
		// A visible explanation, not a blank frame.
		expect(await response?.text()).toContain("Can't preview this file");
	});
});

describe("preview token", () => {
	it("serves nothing when the sidecar has no approval token", async () => {
		const open = createFetchHandler({} as SidecarContext);
		const response = await open(
			new Request(
				`http://127.0.0.1:3126/preview-file/${derivePreviewToken("")}${workspace}/snake.html`,
			),
			{ port: 3126, upgrade: () => false },
		);
		expect(response?.status).toBe(403);
	});
});
