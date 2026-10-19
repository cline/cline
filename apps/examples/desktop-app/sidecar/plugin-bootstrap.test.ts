import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLINE_PLUGIN_BOOTSTRAP_PATH_ENV } from "@cline/core";
import { expect, it } from "vitest";
import {
	configurePluginBootstrap,
	resolveDesktopPluginBootstrap,
} from "./plugin-bootstrap";

function withLayout(
	resourceDirectory: (root: string) => string,
	execPath: (root: string) => string,
	check: (bootstrap: string, execPath: string) => void,
): void {
	const root = mkdtempSync(join(tmpdir(), "cline-plugin-bootstrap-"));
	try {
		const directory = join(resourceDirectory(root), "bin", "extensions");
		mkdirSync(directory, { recursive: true });
		const bootstrap = join(directory, "plugin-sandbox-bootstrap.js");
		writeFileSync(bootstrap, "// bootstrap");
		check(bootstrap, execPath(root));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

it("finds the bootstrap in the macOS app bundle resources", () => {
	withLayout(
		(root) => join(root, "Cline.app", "Contents", "Resources"),
		(root) => join(root, "Cline.app", "Contents", "MacOS", "cline-cli"),
		(bootstrap, execPath) => {
			expect(resolveDesktopPluginBootstrap({ execPath, cwd: tmpdir() })).toBe(
				bootstrap,
			);
		},
	);
});

it("finds the bootstrap in the Linux and Windows resource layouts", () => {
	withLayout(
		(root) => join(root, "usr", "lib", "Cline"),
		(root) => join(root, "usr", "bin", "cline-cli"),
		(bootstrap, execPath) => {
			expect(resolveDesktopPluginBootstrap({ execPath, cwd: tmpdir() })).toBe(
				bootstrap,
			);
		},
	);
	withLayout(
		(root) => root,
		(root) => join(root, "cline-cli.exe"),
		(bootstrap, execPath) => {
			expect(resolveDesktopPluginBootstrap({ execPath, cwd: tmpdir() })).toBe(
				bootstrap,
			);
		},
	);
});

it("keeps an explicitly configured bootstrap path", () => {
	const env = { [CLINE_PLUGIN_BOOTSTRAP_PATH_ENV]: "/custom/bootstrap.js" };
	configurePluginBootstrap(env);
	expect(env[CLINE_PLUGIN_BOOTSTRAP_PATH_ENV]).toBe("/custom/bootstrap.js");
});
