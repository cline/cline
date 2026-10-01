import { existsSync } from "node:fs";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
type Manifest = {
	name: string;
	version: string;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

async function packageRoot(
	name: string,
	from: string,
): Promise<string | undefined> {
	for (let current = from; ; current = dirname(current)) {
		const candidate = join(current, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) return realpath(candidate);
		if (dirname(current) === current) return undefined;
	}
}

/** Materialize the locked runtime dependency graph without development symlinks.
 * Keep conflicting versions nested, exactly as Node's package resolution expects.
 * No registry installs or dependency resolution occur while packaging. */
export async function packagePluginRuntime(output: string): Promise<void> {
	await rm(output, { recursive: true, force: true });
	await mkdir(join(output, "node_modules"), { recursive: true });
	const installed = new Map<string, string>();
	const install = async (
		source: string,
		destination: string,
	): Promise<void> => {
		installed.set(destination, source);
		const manifest = JSON.parse(
			await readFile(join(source, "package.json"), "utf8"),
		) as Manifest;
		await mkdir(destination, { recursive: true });
		if (manifest.name.startsWith("@cline/")) {
			await cp(join(source, "dist"), join(destination, "dist"), {
				recursive: true,
			});
			await writeFile(
				join(destination, "package.json"),
				JSON.stringify(manifest),
			);
		} else {
			await cp(source, destination, {
				recursive: true,
				dereference: true,
				filter: (path) =>
					path === source ||
					!path
						.slice(source.length + 1)
						.split(/[\\/]/)
						.includes("node_modules"),
			});
		}
		const dependencies = {
			...manifest.peerDependencies,
			...manifest.optionalDependencies,
			...manifest.dependencies,
		};
		for (const name of Object.keys(dependencies)) {
			if (
				manifest.peerDependenciesMeta?.[name]?.optional &&
				!manifest.dependencies?.[name]
			)
				continue;
			const dependency = await packageRoot(name, source);
			if (!dependency) {
				if (manifest.dependencies?.[name])
					throw new Error(
						`Missing locked dependency ${name} of ${manifest.name}`,
					);
				continue;
			}
			let found: string | undefined;
			for (let current = destination; ; current = dirname(current)) {
				const candidate = join(current, "node_modules", name);
				if (installed.has(candidate)) {
					found = installed.get(candidate);
					break;
				}
				if (current === output || dirname(current) === current) break;
			}
			if (found === dependency) continue;
			const topLevel = join(output, "node_modules", name);
			const target = installed.has(topLevel)
				? join(destination, "node_modules", name)
				: topLevel;
			if (installed.get(target) !== dependency)
				await install(dependency, target);
		}
	};
	for (const name of ["shared", "llms", "agents", "core", "sdk"]) {
		const source = resolve(repoRoot, "sdk/packages", name);
		const target = join(output, "node_modules", `@cline/${name}`);
		if (installed.get(target) !== source) await install(source, target);
	}
	await cp(join(repoRoot, "LICENSE"), join(output, "LICENSE"));
	await writeFile(
		join(output, "bunfig.toml"),
		"# Packaged plugin runtime; no workspace configuration.\n",
	);
	await writeFile(
		join(output, "package.json"),
		JSON.stringify({ private: true, type: "module" }),
	);
}
