import fs from "node:fs/promises";
import path from "node:path";
import type {
	EnterpriseBundleStore,
	EnterpriseConfigBundle,
} from "../contracts";

export class FileEnterpriseBundleStore implements EnterpriseBundleStore {
	constructor(private readonly filePath: string) {}

	async read(): Promise<EnterpriseConfigBundle | undefined> {
		try {
			return JSON.parse(
				await fs.readFile(this.filePath, "utf8"),
			) as EnterpriseConfigBundle;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return undefined;
			}
			throw error;
		}
	}

	async write(bundle: EnterpriseConfigBundle): Promise<void> {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true });
		await fs.writeFile(this.filePath, JSON.stringify(bundle, null, 2), "utf8");
	}

	async clear(): Promise<void> {
		await fs.rm(this.filePath, { force: true });
	}
}
