import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./plan";

// A missing version permits publishing; registry/auth/network errors must fail.
export async function versionExists(
	name: string,
	version: string,
	request: (url: string) => Promise<Response> = fetch,
): Promise<boolean> {
	const response = await request(
		`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
	);
	if (response.status === 404) return false;
	if (!response.ok)
		throw new Error(
			`Registry lookup failed for ${name}@${version}: ${response.status}`,
		);
	const manifest = (await response.json()) as {
		name?: string;
		version?: string;
	};
	if (manifest.name !== name || manifest.version !== version)
		throw new Error(`Unexpected registry response for ${name}@${version}`);
	return true;
}

if (import.meta.main) {
	const version = process.env.VERSION;
	const channel = process.env.CHANNEL;
	if (!version || (channel !== "latest" && channel !== "nightly"))
		throw new Error("VERSION and CHANNEL are required");
	const packages = ["shared", "llms", "agents", "core", "sdk"];
	for (const name of packages) {
		const manifest = JSON.parse(
			readFileSync(`sdk/packages/${name}/package.json`, "utf8"),
		);
		if (manifest.name !== `@cline/${name}` || manifest.version !== version)
			throw new Error(`Unexpected package version: ${name}`);
	}
	const destination = mkdtempSync(join(tmpdir(), "sdk-publish-"));
	try {
		for (const name of packages) {
			const fullName = `@cline/${name}`;
			if (await versionExists(fullName, version)) {
				console.log(`${fullName}@${version} already published; skipping`);
				continue;
			}
			const cwd = resolve(`sdk/packages/${name}`);
			const tarball = run(
				["bun", "pm", "pack", "--destination", destination, "--quiet"],
				cwd,
			);
			console.log(
				run(
					[
						"npm",
						"publish",
						resolve(destination, tarball),
						"--tag",
						channel,
						"--access",
						"public",
					],
					cwd,
				),
			);
		}
	} finally {
		rmSync(destination, { recursive: true, force: true });
	}
}
