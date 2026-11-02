import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type TestContext, test } from "vitest";
import { createPublishArtifactsTool } from "../publish";
import { createArtifactPublisher } from "./publish";

type Scenario =
	| "success"
	| "auth"
	| "changed"
	| "small"
	| "expired400"
	| "expired"
	| "transient"
	| "lost"
	| "body-interrupted"
	| "forbidden"
	| "unavailable"
	| "reject";

async function fixture(
	t: TestContext,
	scenario: Scenario = "success",
	onSign?: () => void,
) {
	const cwd = await mkdtemp(join(tmpdir(), "publish-artifacts-"));
	t.onTestFinished(() => rm(cwd, { recursive: true, force: true }));
	const filePath = join(cwd, "hello 世界.txt");
	await writeFile(filePath, "hello\n");
	const prefix = "sessions/user_demo/session_demo/artifacts/";
	const fields = {
		"x-goog-algorithm": "GOOG4-RSA-SHA256",
		"Content-Type": "application/octet-stream",
		policy: "synthetic-policy",
		"x-goog-signature": "synthetic-signature",
	};
	const stored = new Map<string, Buffer>();
	const keys: string[] = [];
	let signs = 0;
	let uploads = 0;
	let origin = "";
	const server = createServer(async (req, res) => {
		assert.equal(req.headers.authorization, undefined);
		assert.equal(req.headers.cookie, undefined);
		if (req.url === "/api/v1/session/session_demo/artifacts/upload-policy") {
			assert.equal(req.method, "POST");
			signs++;
			onSign?.();
			if (scenario === "auth") return void res.writeHead(401).end();
			if (scenario === "changed")
				await writeFile(filePath, "changed after signing");
			res.setHeader("Content-Type", "application/json");
			res.end(
				JSON.stringify({
					success: true,
					data: {
						url: `${origin}/storage`,
						fields,
						keyPrefix: prefix,
						maxBytes: scenario === "small" ? 5 : 1 << 30,
						expiresAt: new Date(Date.now() + 60_000).toISOString(),
					},
				}),
			);
			return;
		}
		assert.equal(req.url, "/storage");
		assert.equal(req.method, "POST");
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		const form = await new Request(`${origin}/storage`, {
			method: "POST",
			headers: { "Content-Type": req.headers["content-type"] ?? "" },
			body: Buffer.concat(chunks),
		}).formData();
		const fieldNames = [...form.keys()];
		assert.equal(fieldNames.at(-1), "file");
		assert.equal(fieldNames.length, Object.keys(fields).length + 2);
		for (const [name, value] of Object.entries(fields))
			assert.equal(form.get(name), value);
		const key = form.get("key");
		assert.ok(typeof key === "string" && key.startsWith(prefix));
		const file = form.get("file");
		assert.ok(file instanceof Blob);
		const bytes = Buffer.from(await file.arrayBuffer());
		uploads++;
		keys.push(key);
		const artifactId = key.slice(prefix.length);
		if (scenario === "body-interrupted" && uploads === 1) {
			res.writeHead(403, { "Content-Length": 100 });
			res.write("partial error body");
			setTimeout(() => res.destroy(), 10);
			return;
		}
		if ((scenario === "expired" || scenario === "expired400") && uploads === 1)
			return void res
				.writeHead(scenario === "expired400" ? 400 : 403)
				.end("<Error><Message>Policy expired</Message></Error>");
		if (scenario === "forbidden")
			return void res
				.writeHead(403)
				.end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
		if (
			(scenario === "transient" && uploads === 1) ||
			scenario === "unavailable"
		)
			return void res.writeHead(503).end();
		if (scenario === "reject" && artifactId === "reject")
			return void res.writeHead(400).end();
		stored.set(artifactId, bytes);
		if (scenario === "lost" && uploads === 1) req.socket.destroy();
		else res.writeHead(204).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.onTestFinished(
		() => new Promise<void>((resolve) => server.close(() => resolve())),
	);
	const address = server.address();
	assert.ok(address && typeof address === "object");
	origin = `http://127.0.0.1:${address.port}`;

	const tool = createPublishArtifactsTool({
		publish: createArtifactPublisher({
			request: (path, init) => fetch(`${origin}${path}`, init),
			cloudSessionId: "session_demo",
		}),
	});
	const context = (signal?: AbortSignal) => ({
		agentId: "test-agent",
		sessionId: "inner-session",
		iteration: 1,
		signal,
	});
	return {
		cwd,
		filePath,
		stored,
		keys,
		context,
		tool,
		counts: () => ({ signs, uploads }),
	};
}

test("publishes files and retains ordered per-file results", async (t) => {
	const f = await fixture(t);
	const result = await f.tool.execute(
		{
			files: [
				{ path: f.filePath },
				{ path: join(f.cwd, "missing.png") },
				{ path: f.filePath, artifactId: "" },
				{ path: f.filePath, artifactId: "reports/résumé #1?.txt" },
				{ path: basename(f.filePath) },
			],
		},
		f.context(),
	);
	assert.ok(!("error" in result.files[0]));
	assert.ok("error" in result.files[1]);
	assert.ok("error" in result.files[2]);
	assert.equal(result.files[0].path, f.filePath);
	assert.deepEqual(
		f.stored.get(result.files[0].artifactId),
		await readFile(f.filePath),
	);
	assert.equal(result.files[1].error.code, "FILE_NOT_FOUND");
	assert.equal(result.files[2].error.code, "INVALID_INPUT");
	assert.deepEqual(result.files[3], {
		path: f.filePath,
		artifactId: "reports/résumé #1?.txt",
	});
	assert.deepEqual(
		f.stored.get("reports/résumé #1?.txt"),
		await readFile(f.filePath),
	);
	assert.ok("error" in result.files[4]);
	assert.equal(
		result.files[4].error.message,
		"Each entry requires an absolute file path",
	);
	assert.equal(f.counts().signs, 1);
});

for (const scenario of [
	"expired",
	"expired400",
	"transient",
	"lost",
	"body-interrupted",
] as const) {
	test(`retries ${scenario} uploads using the same artifact ID`, async (t) => {
		const f = await fixture(t, scenario);
		const { files } = await f.tool.execute(
			{ files: [{ path: f.filePath }] },
			f.context(),
		);
		const id = files[0].artifactId;
		assert.ok(!("error" in files[0]));
		assert.ok(id);
		assert.deepEqual(f.stored.get(id), await readFile(f.filePath));
		assert.equal(new Set(f.keys).size, 1);
		assert.equal(f.counts().uploads, 2);
		assert.equal(f.counts().signs, scenario.startsWith("expired") ? 2 : 1);
	});
}

test("reuses the supplied ID and rereads the file on a later call", async (t) => {
	const f = await fixture(t);
	const tool = f.tool;
	const input = { files: [{ path: f.filePath, artifactId: "same" }] };
	assert.deepEqual((await tool.execute(input, f.context())).files, input.files);
	await writeFile(f.filePath, "changed");
	assert.deepEqual((await tool.execute(input, f.context())).files, input.files);
	assert.equal(f.stored.size, 1);
	assert.equal(f.stored.get("same")?.toString(), "changed");
});

for (const scenario of ["auth", "forbidden", "unavailable"] as const) {
	test(`bounds retries for ${scenario}`, async (t) => {
		const f = await fixture(t, scenario);
		const { files } = await f.tool.execute(
			{
				files: [{ path: f.filePath, artifactId: "given" }],
			},
			f.context(),
		);
		assert.ok("error" in files[0]);
		assert.equal(
			files[0].error.code,
			scenario === "auth"
				? "CORE_REJECTED"
				: scenario === "forbidden"
					? "UPLOAD_REJECTED"
					: "UPLOAD_FAILED",
		);
		assert.equal(files[0].artifactId, "given");
		assert.equal(
			f.counts().uploads,
			scenario === "auth" ? 0 : scenario === "forbidden" ? 1 : 3,
		);
	});
}

test("keeps successes when another upload is rejected", async (t) => {
	const f = await fixture(t, "reject");
	const { files } = await f.tool.execute(
		{
			files: ["first", "reject", "last"].map((artifactId) => ({
				path: f.filePath,
				artifactId,
			})),
		},
		f.context(),
	);
	assert.equal(files[0].artifactId, "first");
	assert.ok(!("error" in files[0]));
	assert.ok("error" in files[1]);
	assert.equal(files[1].error.code, "UPLOAD_REJECTED");
	assert.equal(files[2].artifactId, "last");
	assert.equal(f.stored.size, 2);
});

for (const scenario of ["changed", "small"] as const) {
	test(`rejects ${scenario} files before upload`, async (t) => {
		const f = await fixture(t, scenario);
		const { files } = await f.tool.execute(
			{ files: [{ path: f.filePath }] },
			f.context(),
		);
		assert.ok("error" in files[0]);
		assert.equal(
			files[0].error.code,
			scenario === "changed" ? "FILE_CHANGED" : "FILE_TOO_LARGE",
		);
		assert.equal(f.counts().uploads, 0);
	});
}

test("uploads an unknown file type without changing its bytes", async (t) => {
	const f = await fixture(t);
	const entry = { path: join(f.cwd, "file.unknown"), artifactId: "binary" };
	const bytes = Buffer.from([0, 1, 127, 128, 255]);
	await writeFile(entry.path, bytes);
	const result = await f.tool.execute({ files: [entry] }, f.context());
	assert.deepEqual(result.files, [entry]);
	assert.deepEqual(f.stored.get(entry.artifactId), bytes);
});

test("aborting during signing stops uploads", async (t) => {
	const controller = new AbortController();
	const f = await fixture(t, "unavailable", () =>
		controller.abort(new Error("Run stopped")),
	);
	const { files } = await f.tool.execute(
		{ files: [{ path: f.filePath }] },
		f.context(controller.signal),
	);
	assert.ok("error" in files[0]);
	assert.equal(files[0].error.code, "CANCELLED");
	assert.equal(f.counts().signs, 1);
	assert.equal(f.counts().uploads, 0);
});

test("rejects malformed upload policies before sending files", async (t) => {
	const f = await fixture(t);
	const policy = {
		url: "http://127.0.0.1:1",
		fields: { policy: "synthetic-policy" },
		keyPrefix: "artifacts/",
		maxBytes: 1024,
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	};
	for (const invalid of [
		{ keyPrefix: "artifacts" },
		{ maxBytes: 0 },
		{ maxBytes: 1.5 },
		{ maxBytes: Number.MAX_SAFE_INTEGER + 1 },
		{ expiresAt: "invalid" },
		{ fields: { File: "reserved" } },
		{ fields: { key: "reserved" } },
		{ fields: { policy: 123 } },
	]) {
		const tool = createPublishArtifactsTool({
			publish: createArtifactPublisher({
				cloudSessionId: "session_demo",
				request: async () =>
					Response.json({ success: true, data: { ...policy, ...invalid } }),
			}),
		});
		const result = await tool.execute(
			{ files: [{ path: f.filePath, artifactId: "given" }] },
			f.context(),
		);
		assert.equal(result.files[0].artifactId, "given");
		assert.ok("error" in result.files[0]);
		assert.equal(result.files[0].error.code, "INVALID_RESPONSE");
	}
});

test("cloud rejects empty files without uploading", async (t) => {
	const f = await fixture(t);
	await writeFile(f.filePath, "");
	const result = await f.tool.execute(
		{ files: [{ path: f.filePath }] },
		f.context(),
	);
	assert.ok("error" in result.files[0]);
	assert.equal(result.files[0].error.code, "EMPTY_FILE");
	assert.equal(f.counts().uploads, 0);
});
