import { dirname, join, relative } from "node:path";
import type { BunPlugin } from "bun";

export function compiledLoggingOptions(
	resolveFrom: string,
	root: string,
	bunfsRoot: string,
) {
	const pino = Bun.resolveSync("pino", resolveFrom);
	const threadStream = Bun.resolveSync("thread-stream", pino);
	const workers = {
		__CLINE_LOG_THREAD__: join(dirname(threadStream), "lib", "worker.js"),
		__CLINE_LOG_PINO__: join(dirname(pino), "lib", "worker.js"),
		__CLINE_LOG_FILE__: join(dirname(pino), "file.js"),
	};
	const plugin: BunPlugin = {
		name: "compiled-logging-workers",
		setup(build) {
			build.onLoad(
				{
					filter:
						/[\\/]thread-stream[\\/]index\.js$|[\\/]pino[\\/]lib[\\/]transport\.js$/,
				},
				async ({ path }) => {
					const contents = (await Bun.file(path).text())
						.replace(
							/join\(__dirname,\s*['"]lib['"],\s*['"]worker\.js['"]\)/g,
							"__CLINE_LOG_THREAD__",
						)
						.replace(
							/join\(__dirname,\s*['"]worker\.js['"]\)/g,
							"__CLINE_LOG_PINO__",
						)
						.replace(
							/join\(__dirname,\s*['"]\.\.['"],\s*['"]file\.js['"]\)/g,
							"__CLINE_LOG_FILE__",
						);
					if (contents.includes("__dirname")) {
						throw new Error("Unmapped logging worker path");
					}
					return { contents, loader: "js" };
				},
			);
		},
	};
	return {
		entrypoints: Object.values(workers),
		plugins: [plugin],
		define: Object.fromEntries(
			Object.entries(workers).map(([key, path]) => [
				key,
				JSON.stringify(bunfsRoot + relative(root, path).replaceAll("\\", "/")),
			]),
		),
	};
}
