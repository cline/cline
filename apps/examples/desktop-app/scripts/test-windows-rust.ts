if (process.platform === "win32") {
	const cargo = Bun.spawnSync(
		["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml"],
		{
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (cargo.exitCode !== 0) {
		process.exit(cargo.exitCode);
	}
}
