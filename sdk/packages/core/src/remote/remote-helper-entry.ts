import {
	type PluginRuntimeResources,
	registerEmbeddedPluginRuntime,
} from "@cline/shared";
import { runRemoteHelperEntrypoint } from "./remote-helper";

// Injected by the compiling host build (see scripts/plugin-runtime-resources.ts).
declare const CLINE_PLUGIN_RUNTIME_RESOURCES: PluginRuntimeResources;
registerEmbeddedPluginRuntime(() => CLINE_PLUGIN_RUNTIME_RESOURCES);

// Executable entrypoint; importing remote/helper never runs the CLI.
void (async () => {
	if (!(await runRemoteHelperEntrypoint()))
		throw new Error("A remote helper command is required");
})().catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
