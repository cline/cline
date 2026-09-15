/**
 * Reproduces a monitor whose direct child exits while a background descendant
 * keeps the inherited stdout/stderr pipes open.
 *
 * Node's `close` event waits for every copy of those pipes to be released, so
 * it does not fire while the descendant lives. Settlement therefore has to be
 * driven from `exit`, or the ended monitor stays listed as running.
 */
const { spawn } = require("node:child_process");

const HOLD_MS = 3_000;

if (process.argv[2] === "child") {
	// Inherited fds stay open for as long as this process lives. It exits on its
	// own so the test cannot leak a process even if teardown misses it.
	setTimeout(() => process.exit(0), HOLD_MS);
} else {
	const holder = spawn(process.execPath, [__filename, "child"], {
		// Not detached: it stays in the monitor's process group so teardown can
		// still reach it. Inheriting stdio is the point of the fixture.
		stdio: "inherit",
	});
	holder.unref();
	process.stdout.write("parent-exiting\n");
	process.exit(0);
}
