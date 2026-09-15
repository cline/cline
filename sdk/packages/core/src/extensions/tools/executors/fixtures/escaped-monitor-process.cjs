const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");

const readyPath = process.env.CLINE_MONITOR_TEST_READY_PATH;
const survivedPath = process.env.CLINE_MONITOR_TEST_SURVIVED_PATH;
if (!readyPath || !survivedPath) {
	throw new Error("Monitor process fixture paths are required");
}

if (process.argv[2] === "child") {
	writeFileSync(readyPath, "ready");
	setTimeout(() => {
		writeFileSync(survivedPath, "survived");
	}, 2_000);
} else {
	const escaped = spawn(process.execPath, [__filename, "child"], {
		detached: true,
		stdio: "ignore",
	});
	escaped.unref();
	// Stay alive long enough for the registry's ownership tracker to observe the
	// child, then exit before session teardown to exercise the orphaned-parent path.
	setTimeout(() => process.exit(0), 500);
}
