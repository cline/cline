import { describe, expect, it } from "vitest";
import {
	resolveDriveConfigDir,
	resolveDriveFacetsPath,
	resolveDriveProviderManifestPath,
	resolveDriveProvidersDir,
} from "./paths";

describe("drive paths", () => {
	it("nests under .cline/drive", () => {
		const norm = (value: string) => value.replaceAll("\\", "/");
		expect(norm(resolveDriveConfigDir("/ws"))).toBe("/ws/.cline/drive");
		expect(norm(resolveDriveFacetsPath("/ws"))).toBe(
			"/ws/.cline/drive/facets.v1.json",
		);
		expect(norm(resolveDriveProvidersDir("/ws"))).toBe(
			"/ws/.cline/drive/providers",
		);
		expect(norm(resolveDriveProviderManifestPath("/ws", "my-whisper"))).toBe(
			"/ws/.cline/drive/providers/my-whisper/manifest.json",
		);
	});
});
