import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RuntimeInstallers } from "./runtime-installer";

it.skipIf(process.platform === "win32")(
	"shutdown kills an installer and its download process",
	async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-installer-cancel-"));
		const installers = new RuntimeInstallers();
		try {
			const script = join(root, "install.sh");
			const pidFile = join(root, "download.pid");
			writeFileSync(
				script,
				'sleep 60 &\nprintf "%s\\n" "$!" > "$PID_FILE"\nwait\n',
			);
			const installing = installers.run("/bin/bash", [script], {
				...process.env,
				PID_FILE: pidFile,
			});
			const rejected = expect(installing).rejects.toThrow("cancelled");
			await expect
				.poll(() => {
					try {
						return Number(readFileSync(pidFile, "utf8"));
					} catch {
						return 0;
					}
				})
				.toBeGreaterThan(0);
			const pid = Number(readFileSync(pidFile, "utf8"));
			await installers.dispose();
			await rejected;
			await expect
				.poll(() => {
					try {
						process.kill(pid, 0);
						return true;
					} catch {
						return false;
					}
				})
				.toBe(false);
			await expect(
				installers.run("/bin/bash", [script], process.env),
			).rejects.toThrow("cancelled");
		} finally {
			await installers.dispose();
			rmSync(root, { recursive: true, force: true });
		}
	},
);
