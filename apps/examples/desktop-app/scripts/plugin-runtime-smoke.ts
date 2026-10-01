import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { packagePluginRuntime } from "./plugin-runtime";

async function main() {
	const desktop = fileURLToPath(new URL("../", import.meta.url));
	const root = await mkdtemp(join(tmpdir(), "cline-packaged-plugins-"));
	try {
		const runtime = join(root, "plugin-runtime");
		const suppliedExecutable = process.argv[2] && resolve(process.argv[2]);
		const suppliedRuntime = process.argv[3] && resolve(process.argv[3]);
		if (suppliedRuntime)
			await cp(suppliedRuntime, runtime, { recursive: true });
		else await packagePluginRuntime(runtime);
		const extension = process.platform === "win32" ? ".exe" : "";
		const host = join(root, `smoke-host${extension}`);
		await $`bun build ./scripts/plugin-runtime-smoke-entry.ts --compile --outfile ${host}`.cwd(
			desktop,
		);
		const workspace = join(root, "workspace");
		const home = join(root, "home");
		await mkdir(join(workspace, ".cline/plugins"), { recursive: true });
		await mkdir(home);
		await writeFile(
			join(workspace, ".cline/plugins/smoke.ts"),
			`
import { createTool } from "@cline/core";
import { z } from "zod";
export default {
 name: "packaged-smoke",
 manifest: { capabilities: ["commands", "tools"] },
 setup(api) {
  if (process.env.BUN_BE_BUN) throw new Error("Sandbox interpreter override leaked into plugin code");
  api.registerCommand({ name: "packaged-smoke", handler: (input: string) => ({ reply: "packaged:" + z.string().parse(input) }) });
  api.registerTool(createTool({ name: "packaged_tool", description: "Packaging smoke test", inputSchema: { type: "object", properties: {} }, execute: async () => ({ ok: true }) }));
 }
};`,
		);
		// Deliberately run outside the checkout with no Node/Bun/CLI in PATH and no
		// host SDK in the plugin workspace. Only the shipped payload can satisfy imports.
		const proc = Bun.spawn([host, workspace], {
			cwd: root,
			env: {
				HOME: home,
				USERPROFILE: home,
				PATH: join(root, "no-runtimes"),
				CLINE_DATA_DIR: join(home, "data"),
				CLINE_PLUGIN_RUNTIME_EXECUTABLE: suppliedExecutable ?? host,
				CLINE_PLUGIN_RUNTIME_DIR: runtime,
			},
			stdout: "inherit",
			stderr: "inherit",
		});
		const code = await proc.exited;
		if (code !== 0)
			throw new Error(`Packaged plugin smoke test exited ${code}`);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
main().catch((error) => {
	console.error(error);
	process.exit(1);
});
