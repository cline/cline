import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "vitest";
import { createPublishArtifactsTool } from "./publish";

const context = { agentId: "test", sessionId: "local", iteration: 1 };
async function fixture(t: TestContext) {
	const dir = await mkdtemp(join(tmpdir(), "artifact-tool-"));
	t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
	const path = join(dir, "report.txt");
	await writeFile(path, "report");
	return { dir, path };
}

test("publishes through an injected store without cloud credentials and preserves result order", async (t) => {
	const { dir, path } = await fixture(t);
	const empty = join(dir, "empty");
	await writeFile(empty, "");
	const stored = new Map<string, Buffer>();
	let batches = 0;
	const tool = createPublishArtifactsTool({
		publish: async (files) => {
			batches++;
			return Promise.all(
				files.map(async (file) => {
					if (file.artifactId === "denied")
						return {
							path: file.path,
							artifactId: file.artifactId,
							error: { code: "DENIED", message: "File rejected" },
						};
					const bytes = await readFile(file.path);
					stored.set(file.artifactId, bytes);
					return { path: file.path, artifactId: file.artifactId };
				}),
			);
		},
	});
	const { files } = await tool.execute(
		{
			files: [
				{ path },
				{ path: join(dir, "missing") },
				{ path, artifactId: "denied" },
				{ path: empty, artifactId: " empty/雪 " },
			],
		},
		context,
	);
	assert.equal(batches, 1);
	assert.ok(!("error" in files[0]));
	assert.deepEqual(stored.get(files[0].artifactId), Buffer.from("report"));
	assert.ok("error" in files[1]);
	assert.equal(files[1].error.code, "FILE_NOT_FOUND");
	assert.ok("error" in files[2]);
	assert.equal(files[2].error.code, "DENIED");
	assert.deepEqual(files[3], { path: empty, artifactId: " empty/雪 " });
	assert.equal(stored.get(" empty/雪 ")?.length, 0);
});

test("rejects invalid batches and entries before invoking storage", async () => {
	let calls = 0;
	const tool = createPublishArtifactsTool({
		publish: async () => {
			calls++;
			return [];
		},
	});
	for (const files of [[], "invalid", Array(21).fill({ path: "/tmp/example" })])
		await assert.rejects(
			async () => tool.execute({ files }, context),
			/1 and 20 files/,
		);
	const result = await tool.execute(
		{ files: [{ path: "relative" }, { path: "/tmp/example", artifactId: "" }] },
		context,
	);
	for (const file of result.files) {
		assert.ok("error" in file);
		assert.equal(file.error.code, "INVALID_INPUT");
	}
	assert.equal(calls, 0);
});

test("reports storage-wide failure without blaming local files and retains retry IDs", async (t) => {
	const { path } = await fixture(t);
	const tool = createPublishArtifactsTool({
		publish: async () => {
			throw new Error("Storage unavailable");
		},
	});
	const result = await tool.execute(
		{ files: [{ path, artifactId: "retry" }] },
		context,
	);
	assert.deepEqual(result.files, [
		{
			path,
			artifactId: "retry",
			error: { code: "PUBLICATION_FAILED", message: "Could not publish files" },
		},
	]);
});
