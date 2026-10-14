import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	collectReleaseAssets,
	UNIX_RELEASE_TARGETS,
} from "./collect-release-assets";

test("release assets preserve executable bytes and describe the same SDK build", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-release-assets-"));
	try {
		const dist = join(root, "dist");
		const output = join(root, "release");
		const identity = { buildId: "sdk-fixture", buildEpochMs: 100 };
		for (const { directory, target } of UNIX_RELEASE_TARGETS) {
			const path = join(dist, directory, "bin");
			mkdirSync(path, { recursive: true });
			writeFileSync(
				join(path, "cline"),
				Buffer.from(`signed executable for ${target}\0`),
			);
		}
		collectReleaseAssets(dist, output, identity);
		for (const { directory, target } of UNIX_RELEASE_TARGETS) {
			const name = `cline-runtime-${target}`;
			const content = readFileSync(join(dist, directory, "bin/cline"));
			expect(readFileSync(join(output, name)).equals(content)).toBe(true);
			expect(readFileSync(join(output, `${name}.sha256`), "utf8")).toBe(
				`${createHash("sha256").update(content).digest("hex")}  ${name}\n`,
			);
			expect(readFileSync(join(output, `${name}.build-id`), "utf8")).toBe(
				"sdk-fixture\n",
			);
			expect(readFileSync(join(output, `${name}.build-epoch`), "utf8")).toBe(
				"100\n",
			);
		}
		expect(readFileSync(join(output, "install.sh"), "utf8")).toContain(
			"--release <cli-tag>",
		);
		expect(() =>
			collectReleaseAssets(dist, output, { buildId: "", buildEpochMs: 0 }),
		).toThrow("Missing runtime SDK");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
