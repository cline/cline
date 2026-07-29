import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

async function fsyncBestEffort(path: string): Promise<void> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(path, "r");
		await handle.sync();
	} catch {
		// Directory fsync is not available on all platforms/filesystems.
	} finally {
		if (handle !== undefined) {
			try {
				await handle.close();
			} catch {
				// Best-effort durability only.
			}
		}
	}
}

export async function writeFileAtomic(
	path: string,
	contents: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(tempPath, "wx");
		await handle.writeFile(contents, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(tempPath, path);
		await fsyncBestEffort(dirname(path));
	} catch (error) {
		if (handle !== undefined) {
			try {
				await handle.close();
			} catch {
				// Preserve the original write error.
			}
		}
		try {
			await rm(tempPath, { force: true });
		} catch {
			// Preserve the original write error.
		}
		throw error;
	}
}
