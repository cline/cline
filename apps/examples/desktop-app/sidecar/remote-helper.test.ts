import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteHelperBinaryFilename } from "@cline/core";
import { expect, it } from "vitest";
import { resolveDesktopRemoteHelper } from "./remote-helper";

it("finds SSH helpers in the installed Windows resource layout", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-packaged-helpers-"));
	try {
		const target = { platform: "linux", arch: "x64" } as const;
		const directory = join(root, "bin", "remote-helpers");
		mkdirSync(directory, { recursive: true });
		const helper = join(directory, remoteHelperBinaryFilename(target));
		writeFileSync(helper, "helper");
		expect(
			resolveDesktopRemoteHelper(target, {
				execPath: join(root, "code-sidecar.exe"),
				cwd: tmpdir(),
				env: {},
			}),
		).toBe(helper);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("finds SSH helpers in the installed Linux resource layout", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-packaged-helpers-"));
	try {
		const target = { platform: "linux", arch: "arm64" } as const;
		const directory = join(
			root,
			"usr",
			"lib",
			"Cline Beta",
			"bin",
			"remote-helpers",
		);
		mkdirSync(directory, { recursive: true });
		const helper = join(directory, remoteHelperBinaryFilename(target));
		writeFileSync(helper, "helper");
		expect(
			resolveDesktopRemoteHelper(target, {
				execPath: join(root, "usr", "bin", "code-sidecar"),
				cwd: tmpdir(),
				env: {},
			}),
		).toBe(helper);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
