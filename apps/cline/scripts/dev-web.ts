const children = [
	Bun.spawn(["bun", "run", "dev:sidecar"], {
		cwd: import.meta.dir + "/..",
		env: { ...process.env, CLINE_SIDECAR_PORT: "3126" },
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	}),
	Bun.spawn(["bun", "run", "dev:web:ui"], {
		cwd: import.meta.dir + "/..",
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	}),
];

let stopping = false;
function stop(signal: NodeJS.Signals): void {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill(signal);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const exits = children.map(async (child) => ({ child, code: await child.exited }));
const first = await Promise.race(exits);
stop("SIGTERM");
await Promise.allSettled(exits);
process.exit(first.code);
