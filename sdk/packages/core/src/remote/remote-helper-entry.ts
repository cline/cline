import { runRemoteHelperEntrypoint } from "./remote-helper";

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
