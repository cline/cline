import fs from "node:fs";
import { dirname, join } from "node:path";

/** Stage every output before replacing any destination; restore on write failure. */
export function writeGeneratedFiles(
	outputs: ReadonlyMap<string, string>,
): void {
	const staged: Array<{
		path: string;
		directory: string;
		next: string;
		backup?: string;
	}> = [];
	const replaced: typeof staged = [];
	let keepRecoveryFiles = false;
	try {
		for (const [path, contents] of outputs) {
			const previous = fs.existsSync(path) ? fs.readFileSync(path) : undefined;
			if (previous?.toString("utf8") === contents) continue;
			fs.mkdirSync(dirname(path), { recursive: true });
			const directory = fs.mkdtempSync(join(dirname(path), ".catalog-stage-"));
			const entry = {
				path,
				directory,
				next: join(directory, "next"),
				backup: previous ? join(directory, "previous") : undefined,
			};
			staged.push(entry);
			fs.writeFileSync(entry.next, contents, "utf8");
			if (entry.backup && previous) fs.writeFileSync(entry.backup, previous);
		}
		for (const entry of staged) {
			fs.renameSync(entry.next, entry.path);
			replaced.push(entry);
		}
	} catch (error) {
		const errors: unknown[] = [error];
		for (const entry of replaced.reverse()) {
			try {
				if (entry.backup) fs.renameSync(entry.backup, entry.path);
				else fs.unlinkSync(entry.path);
			} catch (rollbackError) {
				errors.push(rollbackError);
			}
		}
		if (errors.length > 1) {
			keepRecoveryFiles = true;
			throw new AggregateError(
				errors,
				`Generated output rollback failed; recovery files retained in ${staged.map((entry) => entry.directory).join(", ")}`,
			);
		}
		throw error;
	} finally {
		if (!keepRecoveryFiles) {
			for (const entry of staged)
				fs.rmSync(entry.directory, { recursive: true, force: true });
		}
	}
}
