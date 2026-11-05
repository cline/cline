import { ClineCore, resolvePluginRuntimeDirectory } from "@cline/core";
import { adoptDesktopCliRuntime } from "../../sidecar/cli-runtime";

async function main() {
	adoptDesktopCliRuntime();
	const runtime = resolvePluginRuntimeDirectory();
	if (!runtime?.includes("desktop-backend"))
		throw new Error(`Expected the packaged backend runtime, got ${runtime}`);
	const core = await ClineCore.create({ backendMode: "local" });
	try {
		const workspacePath = process.cwd();
		const { commands } = await core.pluginCommands.list({ workspacePath });
		const result = await core.pluginCommands.run({
			workspacePath,
			prompt: "/packaged-ping",
		});
		process.stdout.write(JSON.stringify({ commands, result }));
	} finally {
		await core.dispose();
	}
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
