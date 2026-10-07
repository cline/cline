import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileSystemRemoteConfigManagedArtifactStore } from "./artifact-store";
import {
	clearMaterializedRemoteConfigRuntime,
	prepareRemoteConfigRuntime,
} from "./runtime";

describe("managed artifact cleanup", () => {
	it("leaves missing directories absent", async () => {
		const workspacePath = await fs.mkdtemp(
			path.join(os.tmpdir(), "managed-cleanup-"),
		);
		try {
			await clearMaterializedRemoteConfigRuntime({ workspacePath });
			await clearMaterializedRemoteConfigRuntime({ workspacePath });
			await expect(fs.readdir(workspacePath)).resolves.toEqual([]);
		} finally {
			await fs.rm(workspacePath, { recursive: true, force: true });
		}
	});

	it.each([
		"EACCES",
		"EIO",
	])("reports %s during instruction cleanup and allows retry", async (code) => {
		const workspacePath = await fs.mkdtemp(
			path.join(os.tmpdir(), "managed-cleanup-"),
		);
		try {
			const prepared = await prepareRemoteConfigRuntime({
				workspacePath,
				controlPlane: {
					name: "test",
					fetchBundle: async () => ({
						source: "test",
						version: "1",
						remoteConfig: {
							version: "v1",
							globalRules: [{ name: "rule", contents: "managed rule" }],
							globalWorkflows: [
								{ name: "workflow", contents: "managed workflow" },
							],
						},
					}),
				},
			});
			const error = Object.assign(new Error("Cannot read managed directory"), {
				code,
			});
			// Both filesystem operations fail for the inaccessible directory.
			const access = vi.spyOn(fs, "access").mockRejectedValueOnce(error);
			const read = vi.spyOn(fs, "readdir").mockRejectedValueOnce(error);
			try {
				await expect(
					clearMaterializedRemoteConfigRuntime({ workspacePath }),
				).rejects.toBe(error);
			} finally {
				access.mockRestore();
				read.mockRestore();
			}
			await expect(
				fs.readFile(prepared.paths.rulesFilePath, "utf8"),
			).resolves.toContain("managed rule");
			await expect(
				fs.readdir(prepared.paths.workflowsPath),
			).resolves.toHaveLength(1);
			await clearMaterializedRemoteConfigRuntime({ workspacePath });
			await expect(fs.readdir(prepared.paths.workflowsPath)).resolves.toEqual(
				[],
			);
			await expect(
				fs.stat(prepared.paths.bundleCachePath),
			).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await fs.rm(workspacePath, { recursive: true, force: true });
		}
	});

	it("reports a managed directory replaced by a file", async () => {
		const workspacePath = await fs.mkdtemp(
			path.join(os.tmpdir(), "managed-cleanup-"),
		);
		try {
			const filePath = path.join(workspacePath, "not-a-directory");
			await fs.writeFile(filePath, "keep");
			await expect(
				new FileSystemRemoteConfigManagedArtifactStore().removeChildren(
					filePath,
				),
			).rejects.toMatchObject({ code: "ENOTDIR" });
			await expect(fs.readFile(filePath, "utf8")).resolves.toBe("keep");
		} finally {
			await fs.rm(workspacePath, { recursive: true, force: true });
		}
	});
});
