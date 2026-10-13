import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFactoryArtifact } from "./factory-artifacts";

const storage = vi.hoisted(() => ({ root: "" }));
vi.mock("@cline/shared/storage", () => ({
	resolveTasksDbPath: () => join(storage.root, "tasks.db"),
}));
let artifactPath: string;
function reply(path = artifactPath) {
	return {
		runs: [
			{
				runId: "run-1",
				factory: { checks: [{ artifacts: [{ path, mimeType: "image/png" }] }] },
			},
		],
	};
}
beforeEach(async () => {
	storage.root = await mkdtemp(join(tmpdir(), "factory-artifacts-test-"));
	const directory = join(storage.root, "factory", "factory-artifacts", "run");
	await mkdir(directory, { recursive: true });
	artifactPath = join(directory, "screen.png");
	await writeFile(artifactPath, Buffer.from([137, 80, 78, 71]));
});
afterEach(async () => {
	await rm(storage.root, { recursive: true, force: true });
});

describe("Factory evidence preview", () => {
	it("returns recorded media for its owning run", async () => {
		expect(await readFactoryArtifact(reply(), "run-1", artifactPath)).toEqual({
			dataUrl: "data:image/png;base64,iVBORw==",
		});
	});
	it("rejects an unrecorded path or another run", async () => {
		await expect(
			readFactoryArtifact(reply(), "run-other", artifactPath),
		).rejects.toThrow("not recorded evidence");
		await expect(
			readFactoryArtifact(reply(), "run-1", join(storage.root, "private.png")),
		).rejects.toThrow("not recorded evidence");
	});
	it("rejects a recorded path replaced with a symlink outside evidence storage", async () => {
		const privateFile = join(storage.root, "private.png");
		await writeFile(privateFile, "private");
		await rm(artifactPath);
		await symlink(privateFile, artifactPath);
		await expect(
			readFactoryArtifact(reply(), "run-1", artifactPath),
		).rejects.toThrow("inside factory artifact storage");
	});
});
