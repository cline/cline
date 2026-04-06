import fs from "node:fs/promises";
import path from "node:path";
import type { EnterpriseAccessToken, EnterpriseTokenStore } from "../contracts";

export class FileEnterpriseTokenStore implements EnterpriseTokenStore {
	constructor(private readonly filePath: string) {}

	async read(): Promise<EnterpriseAccessToken | undefined> {
		try {
			return JSON.parse(
				await fs.readFile(this.filePath, "utf8"),
			) as EnterpriseAccessToken;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return undefined;
			}
			throw error;
		}
	}

	async write(token: EnterpriseAccessToken): Promise<void> {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true });
		await fs.writeFile(this.filePath, JSON.stringify(token, null, 2), "utf8");
	}

	async clear(): Promise<void> {
		await fs.rm(this.filePath, { force: true });
	}
}
