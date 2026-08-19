import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));

describe("@cline/ui package", () => {
	it("is configured for standalone public npm releases", () => {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			internal?: boolean;
			license?: string;
			private?: boolean;
			publishConfig?: { access?: string };
			version?: string;
		};

		expect(manifest.private).toBe(false);
		expect(manifest.internal).toBe(true);
		expect(manifest.publishConfig?.access).toBe("public");
		expect(manifest.license).toBe("Apache-2.0");
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
		expect(manifest.version).not.toBe("0.0.0");
	});
});
