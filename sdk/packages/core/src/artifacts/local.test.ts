import assert from "node:assert/strict";
import { watch } from "node:fs";
import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "vitest";
import { createDefaultTools } from "../extensions/tools/definitions";
import {
	createLocalArtifactFetcher,
	createLocalArtifactPublisher,
} from "./local";
import { createPublishArtifactsTool } from "./publish";

const context = { agentId: "test", sessionId: "local", iteration: 1 };

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "local-artifacts-"));
	t.onTestFinished(() => rm(root, { recursive: true, force: true }));
	const source = join(root, "source.bin");
	const directory = join(root, "session");
	const tool = createPublishArtifactsTool({
		publish: createLocalArtifactPublisher({ directory }),
	});
	const fetch = createLocalArtifactFetcher({ directory });
	const publish = (artifactId = "report", signal?: AbortSignal) =>
		tool.execute(
			{ files: [{ path: source, artifactId }] },
			{ ...context, signal },
		);
	return { root, source, directory, tool, fetch, publish };
}

test("persists an ordered batch after source removal and reopening", async (t) => {
	const f = await fixture(t);
	const bytes = Buffer.from([0, 255, 42, 128]);
	await writeFile(f.source, bytes);
	const empty = join(f.root, "empty");
	await writeFile(empty, "");
	const result = await f.tool.execute(
		{
			files: [
				{ path: f.source },
				{ path: join(f.root, "missing") },
				{ path: empty, artifactId: "empty" },
			],
		},
		context,
	);
	assert.ok(!("error" in result.files[0]));
	assert.ok("error" in result.files[1]);
	assert.equal(result.files[1].error.code, "FILE_NOT_FOUND");
	assert.deepEqual(result.files[2], { path: empty, artifactId: "empty" });
	await rm(f.source);
	await rm(empty);
	const reopened = createLocalArtifactFetcher({ directory: f.directory });
	const response = await reopened({ artifactId: result.files[0].artifactId });
	assert.equal(response.headers.get("content-length"), String(bytes.length));
	assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
	assert.equal(
		(await (await reopened({ artifactId: "empty" })).arrayBuffer()).byteLength,
		0,
	);
	await assert.rejects(reopened({ artifactId: "not-published" }));
});

test("keeps freeform IDs distinct and isolated to their session directory", async (t) => {
	const f = await fixture(t);
	const ids = [
		"../source.bin",
		"a/b",
		"A",
		"a",
		" 雪 ",
		"\ud800",
		"\ud801",
		"�",
	];
	for (const [index, artifactId] of ids.entries()) {
		await writeFile(f.source, String(index));
		assert.ok(!("error" in (await f.publish(artifactId)).files[0]));
	}
	for (const [index, artifactId] of ids.entries())
		assert.equal(await (await f.fetch({ artifactId })).text(), String(index));
	assert.equal(await readFile(f.source, "utf8"), String(ids.length - 1));
	const otherDirectory = join(f.root, "other-session");
	const other = createLocalArtifactFetcher({ directory: otherDirectory });
	await assert.rejects(other({ artifactId: ids[0] }));
	const otherTool = createPublishArtifactsTool({
		publish: createLocalArtifactPublisher({ directory: otherDirectory }),
	});
	await otherTool.execute(
		{ files: [{ path: f.source, artifactId: ids[0] }] },
		context,
	);
	assert.equal(
		await (await other({ artifactId: ids[0] })).text(),
		String(ids.length - 1),
	);
	assert.equal(await (await f.fetch({ artifactId: ids[0] })).text(), "0");
});

test("pins readers to a complete version across replacement and concurrent writes", async (t) => {
	const f = await fixture(t);
	const old = Buffer.alloc(1024 * 1024, 65);
	const next = Buffer.alloc(1024 * 1024, 66);
	await writeFile(f.source, old);
	await f.publish();
	const pinned = await f.fetch({ artifactId: "report" });
	await writeFile(f.source, next);
	assert.ok(!("error" in (await f.publish()).files[0]));
	assert.deepEqual(Buffer.from(await pinned.arrayBuffer()), old);
	assert.deepEqual(
		Buffer.from(await (await f.fetch({ artifactId: "report" })).arrayBuffer()),
		next,
	);
	const another = join(f.root, "another.bin");
	await writeFile(another, old);
	const results = await Promise.all([
		f.publish(),
		f.tool.execute(
			{ files: [{ path: another, artifactId: "report" }] },
			context,
		),
	]);
	for (const result of results) assert.ok(!("error" in result.files[0]));
	const final = Buffer.from(
		await (await f.fetch({ artifactId: "report" })).arrayBuffer(),
	);
	assert.ok(final.equals(old) || final.equals(next));
	assert.equal((await readdir(f.directory)).length, 1);
});

test("rejects changed sources and cancelled writes without replacing stored bytes", async (t) => {
	const f = await fixture(t);
	await writeFile(f.source, "original");
	await f.publish();
	const publish = createLocalArtifactPublisher({ directory: f.directory });
	const tool = createPublishArtifactsTool({
		publish: async (files, options) => {
			await writeFile(f.source, "changed after selection");
			return publish(files, options);
		},
	});
	const result = await tool.execute(
		{ files: [{ path: f.source, artifactId: "report" }] },
		context,
	);
	assert.ok("error" in result.files[0]);
	assert.equal(result.files[0].error.code, "FILE_CHANGED");
	const controller = new AbortController();
	controller.abort();
	const cancelled = await f.publish("report", controller.signal);
	assert.ok("error" in cancelled.files[0]);
	assert.equal(cancelled.files[0].error.code, "CANCELLED");
	assert.equal(
		await (await f.fetch({ artifactId: "report" })).text(),
		"original",
	);
	assert.equal((await readdir(f.directory)).length, 1);
});

test("streams cancellable reads and supports a fresh read afterward", async (t) => {
	const f = await fixture(t);
	const bytes = Buffer.alloc(1024 * 1024, 42);
	await writeFile(f.source, bytes);
	await f.publish();
	const controller = new AbortController();
	const response = await f.fetch({
		artifactId: "report",
		signal: controller.signal,
	});
	assert.ok(response.body);
	const reader = response.body.getReader();
	const first = await reader.read();
	assert.ok(first.value && first.value.byteLength < bytes.length);
	controller.abort();
	await assert.rejects(async () => {
		while (!(await reader.read()).done) {}
	});
	await assert.rejects(
		f.fetch({ artifactId: "report", signal: controller.signal }),
	);
	const cancelled = await f.fetch({ artifactId: "report" });
	await cancelled.body?.cancel();
	assert.deepEqual(
		Buffer.from(await (await f.fetch({ artifactId: "report" })).arrayBuffer()),
		bytes,
	);
});

test("aborts an in-flight replacement without exposing partial bytes or leaving temporary files", async (t) => {
	const f = await fixture(t);
	await writeFile(f.source, "original");
	await f.publish();
	await truncate(f.source, 64 * 1024 * 1024);
	const controller = new AbortController();
	const watcher = watch(f.directory, () => controller.abort());
	try {
		const result = await f.publish("report", controller.signal);
		assert.ok("error" in result.files[0]);
		assert.equal(result.files[0].error.code, "CANCELLED");
		assert.equal(result.files[0].artifactId, "report");
	} finally {
		watcher.close();
	}
	assert.equal(
		await (await f.fetch({ artifactId: "report" })).text(),
		"original",
	);
	assert.equal((await readdir(f.directory)).length, 1);
});

test("constructs inertly and reports destination failures without changing default tools", async (t) => {
	const f = await fixture(t);
	const defaults = () =>
		createDefaultTools({ executors: {} }).map((tool) => tool.name);
	const before = defaults();
	assert.ok(!before.includes("publish_artifacts"));
	assert.deepEqual(await readdir(f.root), []);
	assert.throws(() => createLocalArtifactPublisher({ directory: "relative" }));
	assert.throws(() => createLocalArtifactFetcher({ directory: "relative" }));
	await writeFile(f.source, "data");
	await writeFile(f.directory, "not a directory");
	const result = await f.publish();
	assert.ok("error" in result.files[0]);
	assert.equal(result.files[0].error.code, "WRITE_FAILED");
	assert.equal(result.files[0].artifactId, "report");
	assert.deepEqual(defaults(), before);
});
