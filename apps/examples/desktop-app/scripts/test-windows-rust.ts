if (process.platform === "win32") {
	const tauriConfig = JSON.stringify({
		bundle: {
			// Unit tests do not package or launch generated binaries. Clear these
			// inputs so a fresh CI checkout can compile without ignored build output.
			externalBin: [],
			resources: [],
		},
	});
	const cargo = Bun.spawnSync(
		["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml"],
		{
			env: { ...process.env, TAURI_CONFIG: tauriConfig },
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (cargo.exitCode !== 0) {
		process.exit(cargo.exitCode);
	}
}
