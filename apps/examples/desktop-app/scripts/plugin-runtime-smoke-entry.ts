import {
	CoreSettingsService,
	createRuntimeHost,
	type LocalRuntimeHost,
} from "@cline/core";

async function main() {
	const workspacePath = process.argv[2];
	if (!workspacePath) throw new Error("workspace path required");
	const runtime = (await createRuntimeHost({
		backendMode: "local",
		distinctId: "packaged-plugin-smoke",
	})) as LocalRuntimeHost;
	const manager = runtime.pluginCommands;
	try {
		const catalog = await manager.list({ workspacePath });
		if (
			catalog.status !== "ready" ||
			!catalog.commands.some((c) => c.name === "packaged-smoke")
		) {
			throw new Error(
				`Plugin command discovery failed: ${JSON.stringify(catalog)}`,
			);
		}
		const result = await manager.run({
			workspacePath,
			prompt: "/packaged-smoke hello",
		});
		if (result?.reply !== "packaged:hello")
			throw new Error(`Command execution failed: ${JSON.stringify(result)}`);
		const settings = await new CoreSettingsService().list({
			workspaceRoot: workspacePath,
			cwd: workspacePath,
		});
		const plugin = settings.plugins.find(
			(p) => p.path === workspacePath + "/.cline/plugins/smoke.ts",
		);
		if (
			!plugin?.contributions?.commands.includes("packaged-smoke") ||
			!plugin.contributions.tools.includes("packaged_tool")
		) {
			throw new Error(
				`Plugin contribution inspection failed: ${JSON.stringify(settings.plugins)}`,
			);
		}
		console.log(
			"Packaged plugin discovery, contributions, and command execution passed",
		);
	} finally {
		await runtime.dispose();
	}

	process.exit(0);
}
main().catch((error) => {
	console.error(error);
	process.exit(1);
});
