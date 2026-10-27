import { afterEach, describe, expect, it } from "vitest";
import { resolveClineDir, setClineDir, withHostClineDirEnv } from "./paths";

describe("withHostClineDirEnv", () => {
	const originalDir = resolveClineDir();
	const originalEnv = process.env.CLINE_DIR;

	afterEach(() => {
		setClineDir(originalDir);
		if (originalEnv === undefined) delete process.env.CLINE_DIR;
		else process.env.CLINE_DIR = originalEnv;
	});

	it("copies the host directory into a child env that does not have it", () => {
		delete process.env.CLINE_DIR;
		setClineDir("/tmp/cline-host-dir");
		const parent = { PATH: "/usr/bin" };
		const child = withHostClineDirEnv(parent);

		expect(child.CLINE_DIR).toBe("/tmp/cline-host-dir");
		expect(parent).toEqual({ PATH: "/usr/bin" });
		expect(process.env.CLINE_DIR).toBeUndefined();
	});
});
