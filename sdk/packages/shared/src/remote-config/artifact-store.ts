import fs from "node:fs/promises";
import path from "node:path";
import type {
	RemoteConfigBundle,
	RemoteConfigBundleStore,
	RemoteConfigManagedArtifactStore,
} from "./bundle";

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

export class FileRemoteConfigBundleStore implements RemoteConfigBundleStore {
	constructor(private readonly filePath: string) {}

	async read(): Promise<RemoteConfigBundle | undefined> {
		try {
			return JSON.parse(
				await fs.readFile(this.filePath, "utf8"),
			) as RemoteConfigBundle;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return undefined;
			}
			throw error;
		}
	}

	async write(bundle: RemoteConfigBundle): Promise<void> {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true });
		await fs.writeFile(this.filePath, JSON.stringify(bundle, null, 2), "utf8");
	}

	async clear(): Promise<void> {
		await fs.rm(this.filePath, { force: true });
	}
}

export class FileSystemRemoteConfigManagedArtifactStore
	implements RemoteConfigManagedArtifactStore
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
