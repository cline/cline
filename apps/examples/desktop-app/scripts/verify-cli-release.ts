import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function verifyCliRelease(
	installerDirectory: string,
	fetchMetadata: (url: string) => Promise<string> = async (url) => {
		const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
		if (!response.ok)
			throw new Error(
				`CLI release asset unavailable: ${url} (${response.status})`,
			);
		return response.text();
	},
): Promise<void> {
	const release = (
		await readFile(join(installerDirectory, "release.txt"), "utf8")
	).trim();
	if (!/^cli-v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(release))
		throw new Error("Desktop requires an exact CLI release tag");
	const identity = JSON.parse(
		await readFile(join(installerDirectory, "identity.json"), "utf8"),
	);
	if (
		typeof identity.buildId !== "string" ||
		!identity.buildId.trim() ||
		!Number.isSafeInteger(identity.buildEpochMs) ||
		identity.buildEpochMs <= 0
	)
		throw new Error("Desktop SDK identity is not a compiled build");
	for (const target of [
		"aarch64-apple-darwin",
		"x86_64-apple-darwin",
		"aarch64-unknown-linux-gnu",
		"x86_64-unknown-linux-gnu",
	]) {
		const asset = `cline-runtime-${target}`;
		const url = `https://github.com/cline/cline/releases/download/${release}/${asset}`;
		const [buildId, epoch, checksum] = await Promise.all([
			fetchMetadata(`${url}.build-id`),
			fetchMetadata(`${url}.build-epoch`),
			fetchMetadata(`${url}.sha256`),
		]);
		if (buildId.trim() !== identity.buildId)
			throw new Error(
				`${release} (${target}) has a different SDK build; publish a matching CLI before Desktop`,
			);
		if (
			!/^\d+$/.test(epoch.trim()) ||
			!Number.isSafeInteger(Number(epoch.trim())) ||
			Number(epoch.trim()) <= 0
		)
			throw new Error(`Invalid CLI build epoch for ${target}`);
		if (!new RegExp(`^[a-fA-F0-9]{64}\\s+${asset}$`).test(checksum.trim()))
			throw new Error(`Invalid CLI checksum for ${target}`);
	}
}

if (import.meta.main) {
	void verifyCliRelease(
		resolve(import.meta.dir, "../src-tauri/bin/cli-installer"),
	)
		.then(() =>
			console.log(
				"Desktop's pinned CLI release matches its SDK and has all Unix target metadata",
			),
		)
		.catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
}
