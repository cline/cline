/** Injected filesystem for the bank store. No node:fs in this package. */

export interface BankFs {
	read(path: string): Promise<string | null>;
	write(path: string, content: string): Promise<void>;
	move(from: string, to: string): Promise<void>;
	list(dir: string): Promise<string[]>;
	exists(path: string): Promise<boolean>;
}

/** In-memory BankFs for tests and browser projections. */
export function createMemoryBankFs(
	seed: Record<string, string> = {},
): BankFs {
	const files = new Map<string, string>(Object.entries(normalizeSeed(seed)));

	return {
		async read(path) {
			return files.get(norm(path)) ?? null;
		},
		async write(path, content) {
			files.set(norm(path), content);
		},
		async move(from, to) {
			const key = norm(from);
			const value = files.get(key);
			if (value === undefined) {
				throw new Error(`BankFs.move: missing ${from}`);
			}
			files.delete(key);
			files.set(norm(to), value);
		},
		async list(dir) {
			const prefix = `${norm(dir)}/`;
			const names = new Set<string>();
			for (const path of files.keys()) {
				if (!path.startsWith(prefix)) {
					continue;
				}
				const rest = path.slice(prefix.length);
				const segment = rest.split("/")[0];
				if (segment) {
					names.add(segment);
				}
			}
			return [...names].sort();
		},
		async exists(path) {
			const key = norm(path);
			if (files.has(key)) {
				return true;
			}
			const prefix = `${key}/`;
			for (const candidate of files.keys()) {
				if (candidate.startsWith(prefix)) {
					return true;
				}
			}
			return false;
		},
	};
}

function norm(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizeSeed(
	seed: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(seed)) {
		out[norm(key)] = value;
	}
	return out;
}
