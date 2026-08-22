import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHostCommandHandler } from "./host-commands";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "cline-host-commands-"));
	temporaryDirectories.push(directory);
	return directory;
}

function hostContext(
	workspaceRoot: string,
	workspaceRootLocked: boolean,
	dataDir = workspaceRoot,
) {
	return {
		workspaceRoot,
		workspaceRootLocked,
		client: { getStatus: async () => ({ dataDir }) },
	};
}

function run(command: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolveRun, rejectRun) => {
		execFile(command, args, { cwd }, (error) => {
			if (error) rejectRun(error);
			else resolveRun();
		});
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("host-only desktop commands", () => {
	it("approves an existing web workspace and expands the current user's home", async () => {
		const home = await temporaryDirectory();
		const initial = join(home, "initial");
		const selected = join(home, "selected");
		await Promise.all([mkdir(initial), mkdir(selected)]);
		const handle = createHostCommandHandler({ homeDir: home });
		const ctx = hostContext(initial, false);
		const canonicalSelected = await realpath(selected);

		expect(
			await handle(ctx, "validate_workspace_directory", { path: "~/selected" }),
		).toEqual({
			handled: true,
			result: { valid: true, path: canonicalSelected },
		});
		expect(
			await handle(ctx, "validate_workspace_directory", {
				path: "~/missing",
			}),
		).toEqual({ handled: true, result: { valid: false } });
	});

	it("does not let a locked sidecar approve or open paths outside its workspace", async () => {
		const root = await temporaryDirectory();
		const workspace = join(root, "workspace");
		const outside = join(root, "outside");
		await Promise.all([mkdir(workspace), mkdir(outside)]);
		await writeFile(join(outside, "secret.txt"), "secret");
		const handle = createHostCommandHandler({
			launchDetached: async () => {},
		});
		const ctx = hostContext(workspace, true);

		expect(
			await handle(ctx, "validate_workspace_directory", { path: outside }),
		).toEqual({ handled: true, result: { valid: false } });
		await expect(
			handle(ctx, "open_file_in_editor", {
				cwd: workspace,
				path: "../outside/secret.txt",
				editor: "default",
			}),
		).rejects.toThrow("escapes the selected workspace");
	});

	it("rejects a symlink that resolves outside the selected workspace", async () => {
		const root = await temporaryDirectory();
		const workspace = join(root, "workspace");
		const outside = join(root, "outside");
		await Promise.all([mkdir(workspace), mkdir(outside)]);
		await writeFile(join(outside, "secret.txt"), "secret");
		await symlink(join(outside, "secret.txt"), join(workspace, "shortcut.txt"));
		const handle = createHostCommandHandler({
			launchDetached: async () => {},
		});

		await expect(
			handle(hostContext(workspace, true), "open_file_in_editor", {
				path: "shortcut.txt",
				editor: "default",
			}),
		).rejects.toThrow("escapes the selected workspace");
	});

	it("lists and checks out only existing local Git branches", async () => {
		const workspace = await temporaryDirectory();
		await run("git", ["init", "-b", "main"], workspace);
		await writeFile(join(workspace, "README.md"), "hello\n");
		await run("git", ["add", "README.md"], workspace);
		await run(
			"git",
			[
				"-c",
				"user.name=Cline Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-m",
				"initial",
			],
			workspace,
		);
		await run("git", ["branch", "feature/safe"], workspace);
		const handle = createHostCommandHandler();
		const ctx = hostContext(workspace, true);

		expect(await handle(ctx, "get_git_branch", { cwd: workspace })).toEqual({
			handled: true,
			result: { branch: "main" },
		});
		expect(await handle(ctx, "list_git_branches", { cwd: workspace })).toEqual({
			handled: true,
			result: {
				current: "main",
				branches: ["feature/safe", "main"],
			},
		});
		expect(
			await handle(ctx, "checkout_git_branch", {
				cwd: workspace,
				branch: "feature/safe",
			}),
		).toEqual({ handled: true, result: { branch: "feature/safe" } });
		await expect(
			handle(ctx, "checkout_git_branch", {
				cwd: workspace,
				branch: "--upload-pack=malicious",
			}),
		).rejects.toThrow("Unknown local Git branch");
	});

	it("searches regular workspace files without traversing dependency or symlink trees", async () => {
		const root = await temporaryDirectory();
		const workspace = join(root, "workspace");
		const outside = join(root, "outside");
		await Promise.all([
			mkdir(join(workspace, "src"), { recursive: true }),
			mkdir(join(workspace, "node_modules", "hidden"), { recursive: true }),
			mkdir(outside),
		]);
		await Promise.all([
			writeFile(join(workspace, "src", "app.ts"), ""),
			writeFile(join(workspace, "src", "apple.test.ts"), ""),
			writeFile(join(workspace, "README.md"), ""),
			writeFile(join(workspace, "node_modules", "hidden", "app.js"), ""),
			writeFile(join(outside, "app-secret.ts"), ""),
		]);
		await symlink(outside, join(workspace, "linked-outside"));
		const handle = createHostCommandHandler();

		expect(
			await handle(hostContext(workspace, true), "search_workspace_files", {
				workspaceRoot: workspace,
				query: "app",
				limit: 10,
			}),
		).toEqual({
			handled: true,
			result: ["src/app.ts", "src/apple.test.ts"],
		});
	});

	it("discovers editors and launches files without shell interpolation", async () => {
		const root = await temporaryDirectory();
		const workspace = join(root, "workspace");
		const bin = join(root, "bin");
		await Promise.all([mkdir(workspace), mkdir(bin)]);
		const code = join(bin, "code");
		const source = join(workspace, "unsafe & name.ts");
		await Promise.all([
			writeFile(code, "#!/bin/sh\nexit 0\n"),
			writeFile(source, "export {};\n"),
		]);
		await chmod(code, 0o755);
		const [canonicalCode, canonicalSource] = await Promise.all([
			realpath(code),
			realpath(source),
		]);
		const launches: Array<{ command: string; args: readonly string[] }> = [];
		const handle = createHostCommandHandler({
			platform: "linux",
			env: { PATH: bin },
			launchDetached: async (command, args) => {
				launches.push({ command, args });
			},
		});
		const ctx = hostContext(workspace, true);

		expect(await handle(ctx, "list_available_editors")).toEqual({
			handled: true,
			result: [{ id: "vscode", label: "VS Code" }],
		});
		expect(
			await handle(ctx, "open_file_in_editor", {
				path: "unsafe & name.ts",
				editor: "vscode",
			}),
		).toEqual({ handled: true, result: "VS Code" });
		expect(launches).toEqual([
			{ command: canonicalCode, args: [canonicalSource] },
		]);
	});

	it("opens an existing configured MCP settings file without mutating it", async () => {
		const root = await temporaryDirectory();
		const workspace = join(root, "workspace");
		const settingsFile = join(root, "mcp-settings.json");
		await mkdir(workspace);
		await writeFile(settingsFile, '{"mcpServers":{}}\n');
		const canonicalSettingsFile = await realpath(settingsFile);
		const launches: Array<{ command: string; args: readonly string[] }> = [];
		const handle = createHostCommandHandler({
			platform: "linux",
			launchDetached: async (command, args) => {
				launches.push({ command, args });
			},
		});

		expect(
			await handle(
				hostContext(workspace, true, root),
				"open_mcp_settings_file",
				{ path: settingsFile },
			),
		).toEqual({ handled: true, result: canonicalSettingsFile });
		expect(launches).toEqual([
			{ command: "xdg-open", args: [canonicalSettingsFile] },
		]);
	});

	it("does not create a missing MCP settings file", async () => {
		const workspace = await temporaryDirectory();
		const missing = join(workspace, "mcp-settings.json");
		const handle = createHostCommandHandler({
			launchDetached: async () => {},
		});

		await expect(
			handle(hostContext(workspace, true), "open_mcp_settings_file", {
				path: missing,
			}),
		).rejects.toThrow("MCP settings file does not exist");
	});

	it("opens only allowlisted external URL protocols", async () => {
		const workspace = await temporaryDirectory();
		const launches: Array<{ command: string; args: readonly string[] }> = [];
		const handle = createHostCommandHandler({
			platform: "linux",
			launchDetached: async (command, args) => {
				launches.push({ command, args });
			},
		});
		const ctx = hostContext(workspace, true);

		expect(
			await handle(ctx, "open_external_url", {
				url: "https://example.com/docs?q=a%20b",
			}),
		).toEqual({ handled: true, result: { opened: true } });
		expect(launches).toEqual([
			{
				command: "xdg-open",
				args: ["https://example.com/docs?q=a%20b"],
			},
		]);
		await expect(
			handle(ctx, "open_external_url", { url: "file:///etc/passwd" }),
		).rejects.toThrow("Only http(s), mailto, and tel");
		await expect(
			handle(ctx, "open_external_url", {
				url: "https://user:password@example.com/",
			}),
		).rejects.toThrow("cannot contain credentials");
	});

	it("returns cancellation for browser-only native pickers and declines unknown commands", async () => {
		const workspace = await temporaryDirectory();
		const handle = createHostCommandHandler();
		const ctx = hostContext(workspace, false);

		expect(await handle(ctx, "pick_workspace_directory")).toEqual({
			handled: true,
			result: null,
		});
		expect(await handle(ctx, "pick_bot_icon_file")).toEqual({
			handled: true,
			result: null,
		});
		expect(await handle(ctx, "not_a_host_command")).toEqual({ handled: false });
	});
});
