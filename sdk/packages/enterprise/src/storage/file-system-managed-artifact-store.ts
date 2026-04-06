import fs from "node:fs/promises";
import path from "node:path";
import type { EnterpriseManagedArtifactStore } from "../contracts";

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

export class FileSystemEnterpriseManagedArtifactStore
	implements EnterpriseManagedArtifactStore
{
	async writeText(filePath: string, contents: string): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, contents, "utf8");
	}

	async remove(targetPath: string): Promise<void> {
		await fs.rm(targetPath, { recursive: true, force: true });
	}

	async removeChildren(directoryPath: string): Promise<void> {
		if (!(await pathExists(directoryPath))) {
			return;
		}
		const entries = await fs.readdir(directoryPath);
		await Promise.all(
			entries.map((entry) =>
				fs.rm(path.join(directoryPath, entry), {
					recursive: true,
					force: true,
				}),
			),
		);
	}
}
