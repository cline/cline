import { expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	renameSync,
	rmSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { compiledLoggingOptions } from "./compiled-logging";

const windows = process.platform === "win32";
it.skipIf(process.arch !== "x64" || (!windows && process.platform !== "linux"))(
	"writes a Pino transport log from a relocated standalone binary",
	async () => {
		const root = resolve(import.meta.dir, "../../..");
		const cache = join(root, ".build-cache");
		mkdirSync(cache, { recursive: true });
		const stage = mkdtempSync(join(cache, "compiled-logging-"));
		try {
			const cli = resolve(import.meta.dir, "..");
			const bunfsRoot = windows ? "B:/~BUN/root/" : "/$bunfs/root/";
			const logging = compiledLoggingOptions(cli, root, bunfsRoot);
			const entry = join(stage, "probe.ts");
			const name = windows ? "probe.exe" : "probe";
			const output = join(stage, name);
			await Bun.write(
				entry,
				`
import pino from ${JSON.stringify(Bun.resolveSync("pino", cli))};
const transport = pino.transport({ target: "pino/file", options: { destination: process.argv.at(-1) } });
await new Promise((resolve, reject) => { transport.once("ready", resolve); transport.once("error", reject); });
const logger = pino({}, transport);
logger.info("logging-worker-fixture");
await new Promise((resolve, reject) => logger.flush((error) => error ? reject(error) : resolve()));
transport.end();
await new Promise((resolve) => transport.once("close", resolve));
`,
			);
			const build = await Bun.build({
				...logging,
				entrypoints: [entry, ...logging.entrypoints],
				root,
				minify: true,
				splitting: true,
				compile: {
					target: windows
						? "bun-windows-x64-baseline"
						: "bun-linux-x64-baseline",
					outfile: output,
				},
			});
			expect(build.success).toBe(true);
			const relocated = join(stage, "relocated");
			mkdirSync(relocated);
			const binary = join(relocated, name);
			renameSync(output, binary);
			const executable = Buffer.from(await Bun.file(binary).arrayBuffer());
			for (const path of [
				root,
				root.replaceAll("\\", "/"),
				root.replaceAll("\\", "\\\\"),
			]) {
				expect(executable.includes(Buffer.from(path))).toBe(false);
			}
			const log = join(relocated, "fixture.log");
			const result = Bun.spawnSync([binary, log], {
				cwd: relocated,
				timeout: 15_000,
			});
			if (result.exitCode !== 0) throw new Error(result.stderr.toString());
			expect(await Bun.file(log).text()).toContain("logging-worker-fixture");
		} finally {
			if (!realpathSync(stage).startsWith(realpathSync(cache) + sep)) {
				throw new Error("Test cleanup path escape");
			}
			rmSync(stage, { recursive: true, force: true });
		}
	},
	120_000,
);
