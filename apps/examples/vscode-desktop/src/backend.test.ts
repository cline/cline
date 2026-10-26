import { describe, expect, it } from "vitest";
import { buildBackendLaunch, isCompiledCli } from "./backend";

describe("isCompiledCli", () => {
	it("treats bun binaries as bun", () => {
		expect(isCompiledCli("/opt/homebrew/bin/bun")).toBe(false);
		expect(isCompiledCli("bun")).toBe(false);
		expect(isCompiledCli("C:\\bun\\bun.exe")).toBe(false);
	});
	it("treats anything else as a compiled cline CLI", () => {
		expect(isCompiledCli("/Applications/Cline.app/Contents/MacOS/cline-cli")).toBe(
			true,
		);
	});
});

describe("buildBackendLaunch", () => {
	const base = {
		entryPath: "/repo/apps/examples/desktop-app/sidecar/index.ts",
		workspaceRoot: "/work",
		port: 4321,
		approvalToken: "tok",
		baseEnv: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" },
	};

	it("runs sidecar/index.ts with bun from the workspace root", () => {
		const launch = buildBackendLaunch({ ...base, runtimePath: "/x/bun" });
		expect(launch.args).toEqual(["run", base.entryPath]);
		expect(launch.cwd).toBe("/work");
		expect(launch.env.CLINE_SIDECAR_PORT).toBe("4321");
		expect(launch.env.CLINE_SIDECAR_APPROVAL_TOKEN).toBe("tok");
		expect(launch.env.CLINE_SIDECAR_TRUSTED_ORIGINS).toBe("vscode-webview://*");
		expect(launch.env.CLINE_DESKTOP_WORKSPACE_ROOT).toBe("/work");
		expect(launch.env.BUN_BE_BUN).toBeUndefined();
	});

	it("never leaks ELECTRON_RUN_AS_NODE into the child", () => {
		const launch = buildBackendLaunch({ ...base, runtimePath: "/x/bun" });
		expect("ELECTRON_RUN_AS_NODE" in launch.env).toBe(false);
	});

	it("mirrors the Tauri launch for a compiled CLI runtime", () => {
		const launch = buildBackendLaunch({
			...base,
			runtimePath: "/app/cline-cli",
			trustedOrigins: ["http://localhost:3125"],
		});
		expect(launch.args).toEqual([
			"run",
			"--use-system-ca",
			"--no-env-file",
			base.entryPath,
		]);
		expect(launch.cwd).toBe("/repo/apps/examples/desktop-app/sidecar");
		expect(launch.env.BUN_BE_BUN).toBe("1");
		expect(launch.env.CLINE_DESKTOP_CLI_PATH).toBe("/app/cline-cli");
		expect(launch.env.CLINE_SIDECAR_TRUSTED_ORIGINS).toBe(
			"vscode-webview://*,http://localhost:3125",
		);
	});
});
