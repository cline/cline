import { $ } from "bun";

const resolveTargetTriple = async (): Promise<string> => {
	const fromEnv = process.env.TAURI_ENV_TARGET_TRIPLE ?? process.env.TARGET;
	if (fromEnv?.trim()) {
		return fromEnv.trim();
	}

	const rustcVersion = await $`rustc -vV`.text();
	const hostLine = rustcVersion
		.split("\n")
		.find((line) => line.startsWith("host: "));
	const host = hostLine?.slice("host: ".length).trim();
	if (!host) {
		throw new Error("failed to resolve Rust host target triple");
	}
	return host;
};

const main = async () => {
	const targetTriple = await resolveTargetTriple();
	const extension = targetTriple.includes("windows") ? ".exe" : "";
	const outfile = `./src-tauri/bin/menubar-sidecar-${targetTriple}${extension}`;

	await $`mkdir -p src-tauri/bin`;
	await $`bun build ./sidecar/index.ts --compile --outfile ${outfile}`;
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
