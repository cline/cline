import { lstatSync, realpathSync, rmSync, statSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	relative,
	resolve,
	sep,
} from "node:path";
import { resolveSkillsConfigSearchPaths } from "@cline/shared/storage";
import { z } from "zod";
import {
	fetchMarketplaceCatalog,
	installMarketplaceSkill,
	isMarketplaceSkillInstalled,
	uninstallMarketplaceSkill,
} from "./marketplace";

const entrySchema = z.object({
	id: z.string().min(1),
	type: z.literal("skill"),
	name: z.string().optional(),
	install: z.object({ args: z.array(z.string().min(1)).min(1) }),
});
async function catalogSkills() {
	const data = z
		.object({ entries: z.array(z.unknown()) })
		.parse(await fetchMarketplaceCatalog());
	return data.entries.flatMap((entry) => {
		const parsed = entrySchema.safeParse(entry);
		return parsed.success ? [parsed.data] : [];
	});
}
const inside = (path: string, root: string) => {
	const rel = relative(root, path);
	return (
		rel === "" ||
		(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
	);
};

/** Machine-global skill mutations serialize so installation and removal cannot overtake each other. */
export class SkillManagementService {
	private tail: Promise<void> = Promise.resolve();
	private mutate<T>(operation: () => Promise<T>): Promise<T> {
		const request = this.tail.then(operation, operation);
		this.tail = request.then(
			() => undefined,
			() => undefined,
		);
		return request;
	}
	async status(ids: string[]) {
		if (!ids.length) return { installedIds: [] };
		const requested = new Set(ids);
		return {
			installedIds: (await catalogSkills())
				.filter(
					(entry) =>
						requested.has(entry.id) && isMarketplaceSkillInstalled(entry),
				)
				.map((entry) => entry.id),
		};
	}
	private async entry(id: string) {
		const entry = (await catalogSkills()).find((entry) => entry.id === id);
		if (!entry)
			throw new Error(`Marketplace skill ${id} was not found in the catalog.`);
		return entry;
	}
	install(id: string) {
		return this.mutate(async () =>
			installMarketplaceSkill(await this.entry(id)),
		);
	}
	uninstall(id: string) {
		return this.mutate(async () =>
			uninstallMarketplaceSkill(await this.entry(id)),
		);
	}
	remove(path: string, workspaceRoot?: string) {
		return this.mutate(async () => {
			if (!isAbsolute(path) || basename(path) !== "SKILL.md")
				throw new Error("Skill removal requires an absolute SKILL.md path");
			const file = resolve(path);
			const root = resolveSkillsConfigSearchPaths(workspaceRoot)
				.map((path) => resolve(path))
				.find((root) => inside(file, root) && file !== root);
			if (!root)
				throw new Error(
					"Skill file must be inside a configured skills directory",
				);
			const directory = dirname(file);
			const target = directory === root ? file : directory;
			// A symlink at the target is removed as a link. Parent symlinks must not escape
			// the configured root, or a nested path could delete an unrelated directory.
			if (!inside(realpathSync(dirname(target)), realpathSync(root)))
				throw new Error(
					"Skill removal cannot traverse a symlink outside its configured directory",
				);
			if (!statSync(file, { throwIfNoEntry: false })?.isFile())
				throw new Error("Skill file does not exist");
			const stats = lstatSync(target);
			rmSync(target, { recursive: stats.isDirectory(), force: false });
			return { removedPath: target };
		});
	}
}
