import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const sharedManifestPath = fileURLToPath(
	new URL("../../shared/package.json", import.meta.url),
);

describe("@cline/ui package", () => {
	it("is published with the SDK packages on their shared version", () => {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			internal?: boolean;
			license?: string;
			private?: boolean;
			publishConfig?: { access?: string };
			version?: string;
		};
		const sharedManifest = JSON.parse(
			readFileSync(sharedManifestPath, "utf8"),
		) as { version?: string };

		expect(manifest.private).toBe(false);
		expect(manifest.internal).toBeUndefined();
		expect(manifest.publishConfig?.access).toBe("public");
		expect(manifest.license).toBe("Apache-2.0");
		expect(manifest.version).toBe(sharedManifest.version);
	});
});
