/**
 * Node-backed BankFs for durable `.drive/bank/` trees.
 * `@cline/drive` stays pure — this adapter lives in core (Node allowed).
 */

import { constants } from "node:fs";
import {
	access,
	mkdir,
	readdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import type { BankFs } from "@cline/drive";

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	);
}

async function ensureParent(filePath: string): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
}

/** Filesystem BankFs using node:fs/promises. Paths are absolute workspace paths. */
export function createNodeBankFs(): BankFs {
	return {
		async read(path) {
			try {
				return await readFile(path, "utf8");
			} catch (error) {
				if (isNotFound(error)) {
					return null;
				}
				throw error;
			}
		},

		async write(path, content) {
			await ensureParent(path);
			await writeFile(path, content, "utf8");
		},

		async move(from, to) {
			await ensureParent(to);
			await rename(from, to);
		},

		async list(dir) {
			try {
				const entries = await readdir(dir, { withFileTypes: true });
				return entries.map((entry) => entry.name).sort();
			} catch (error) {
				if (isNotFound(error)) {
					return [];
				}
				throw error;
			}
		},

		async exists(path) {
			try {
				await access(path, constants.F_OK);
				return true;
			} catch {
				return false;
			}
		},
	};
}
