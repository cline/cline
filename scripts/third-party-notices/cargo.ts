import { dirname } from "node:path";
import { $ } from "bun";
import {
	fallbackLicenseTexts,
	type NoticeEntry,
	readLicenseTexts,
} from "./index";

interface CargoPackage {
	id: string;
	name: string;
	version: string;
	license: string | null;
	license_file: string | null;
	repository: string | null;
	authors: string[];
	manifest_path: string;
	targets: { kind: string[] }[];
}

interface CargoMetadata {
	packages: CargoPackage[];
	workspace_members: string[];
	resolve: {
		root: string | null;
		nodes: {
			id: string;
			deps: { pkg: string; dep_kinds: { kind: string | null }[] }[];
		}[];
	};
}

// Crates linked into the binary for these targets: normal dependencies reachable from the
// workspace. Build-script deps and proc-macros (and their deps) only run at compile time.
async function linkedCrates(
	manifestPath: string,
	targets: string[],
): Promise<CargoPackage[]> {
	const linked = new Map<string, CargoPackage>();
	for (const target of targets) {
		const metadata =
			(await $`cargo metadata --format-version 1 --locked --manifest-path ${manifestPath} --filter-platform ${target}`
				.quiet()
				.json()) as CargoMetadata;
		const packages = new Map(metadata.packages.map((p) => [p.id, p]));
		const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
		const isProcMacro = (id: string) =>
			packages.get(id)?.targets.every((t) => t.kind.includes("proc-macro"));
		const queue = [...metadata.workspace_members];
		const seen = new Set(queue);
		while (queue.length > 0) {
			const node = nodes.get(queue.pop() as string);
			for (const dep of node?.deps ?? []) {
				if (seen.has(dep.pkg) || isProcMacro(dep.pkg)) continue;
				if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
				seen.add(dep.pkg);
				queue.push(dep.pkg);
				linked.set(dep.pkg, packages.get(dep.pkg) as CargoPackage);
			}
		}
	}
	return [...linked.values()];
}

export async function cargoCrateEntries(
	manifestPath: string,
	targets: string[],
): Promise<NoticeEntry[]> {
	const crates = await linkedCrates(manifestPath, targets);
	return crates.map((crate) => {
		// Older crates use "MIT/Apache-2.0" for an OR expression.
		const license = (crate.license ?? "").replace(/\s*\/\s*/g, " OR ");
		const root = dirname(crate.manifest_path);
		const texts = readLicenseTexts(root, crate.license_file ?? undefined);
		const holder =
			crate.authors[0]?.replace(/\s*<.*$/, "") ?? `the ${crate.name} authors`;
		const source = `https://crates.io/crates/${crate.name}/${crate.version}`;
		return {
			name: crate.name,
			version: crate.version,
			license: license || (crate.license_file ? "see license text below" : ""),
			repository: crate.repository ?? source,
			texts: [
				// MPL-2.0 requires telling recipients where the Source Code Form is available.
				...(/MPL-2\.0/.test(license)
					? [
							{
								file: "Source Code Form",
								content: `The Source Code Form of ${crate.name} ${crate.version} is available at ${source}.`,
							},
						]
					: []),
				...(texts.length ? texts : fallbackLicenseTexts(license, holder)),
			],
		};
	});
}
