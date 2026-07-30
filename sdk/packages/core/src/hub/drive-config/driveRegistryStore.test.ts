import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	readDriveRegistryFile,
	resolvePackFromRegistry,
	writeDriveRegistryFile,
} from "./driveRegistryStore";

describe("driveRegistryStore", () => {
	it("writes and reads a registry; lookup by slug works", () => {
		const root = mkdtempSync(join(tmpdir(), "drive-registry-"));
		try {
			writeDriveRegistryFile(root, {
				schemaVersion: 1,
				packs: {
					cyber: {
						id: "cyber",
						slug: "cybersecurity",
						displayName: "Cybersecurity",
						members: [
							{ profileId: "reviewer", role: "specialist" },
						],
						addressable: true,
					},
				},
			});
			const loaded = readDriveRegistryFile(root);
			expect(loaded?.packs.cyber?.displayName).toBe("Cybersecurity");
			expect(resolvePackFromRegistry(root, "cybersecurity")?.id).toBe(
				"cyber",
			);
			expect(resolvePackFromRegistry(root, "missing")).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns null when the file is missing", () => {
		const root = mkdtempSync(join(tmpdir(), "drive-registry-missing-"));
		try {
			expect(readDriveRegistryFile(root)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
