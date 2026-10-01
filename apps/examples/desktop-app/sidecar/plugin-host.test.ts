import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveDesktopPluginHostDir } from "./plugin-host";

function withRoot(run: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "cline-plugin-host-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

it("finds the plugin host in the macOS bundle layout", () => {
	withRoot((root) => {
		const pluginHost = join(
			root,
			"Cline.app",
			"Contents",
			"Resources",
			"plugin-host",
		);
		mkdirSync(pluginHost, { recursive: true });
		expect(
			resolveDesktopPluginHostDir({
				execPath: join(root, "Cline.app", "Contents", "MacOS", "code-sidecar"),
				env: {},
			}),
		).toBe(pluginHost);
	});
});

it("finds the plugin host next to the Windows executable", () => {
	withRoot((root) => {
		const pluginHost = join(root, "plugin-host");
		mkdirSync(pluginHost, { recursive: true });
		expect(
			resolveDesktopPluginHostDir({
				execPath: join(root, "code-sidecar.exe"),
				env: {},
			}),
		).toBe(pluginHost);
	});
});

it("finds the plugin host in the Linux lib directory for any product name", () => {
	withRoot((root) => {
		const pluginHost = join(root, "usr", "lib", "Cline Beta", "plugin-host");
		mkdirSync(pluginHost, { recursive: true });
		expect(
			resolveDesktopPluginHostDir({
				execPath: join(root, "usr", "bin", "cline-code"),
				env: {},
			}),
		).toBe(pluginHost);
	});
});

it("finds the plugin host beside the repo's compiled sidecar", () => {
	withRoot((root) => {
		const pluginHost = join(root, "src-tauri", "plugin-host");
		mkdirSync(pluginHost, { recursive: true });
		expect(
			resolveDesktopPluginHostDir({
				execPath: join(
					root,
					"src-tauri",
					"bin",
					"code-sidecar-aarch64-apple-darwin",
				),
				env: {},
			}),
		).toBe(pluginHost);
	});
});

it("prefers an explicit override and reports a missing host as undefined", () => {
	withRoot((root) => {
		expect(
			resolveDesktopPluginHostDir({
				execPath: join(root, "code-sidecar"),
				env: { CLINE_PLUGIN_HOST_DIR: "/custom/plugin-host" },
			}),
		).toBe("/custom/plugin-host");
		expect(
			resolveDesktopPluginHostDir({
				execPath: join(root, "code-sidecar"),
				env: {},
			}),
		).toBeUndefined();
	});
});
