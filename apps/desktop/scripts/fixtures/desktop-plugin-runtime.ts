import {
	createPluginCommandService,
	resolvePluginRuntimeDirectory,
} from "@cline/core";
import { adoptDesktopCliRuntime } from "../../sidecar/cli-runtime";

async function main() {
	adoptDesktopCliRuntime();
	const runtime = resolvePluginRuntimeDirectory();
	if (!runtime?.includes("desktop-backend"))
		throw new Error(`Expected the packaged backend runtime, got ${runtime}`);
	const service = createPluginCommandService({ cwd: process.cwd() });
	try {
		const commands = await service.listCommands();
		const result = await service.run("packaged-ping", "");
		process.stdout.write(JSON.stringify({ commands, result }));
	} finally {
		await service.shutdown();
	}
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
