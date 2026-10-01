import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	buildWindowsInstaller,
	findNSISCompiler,
	runInstallerCommand,
} from "./build-windows-installer";

const windows =
	process.platform === "win32" &&
	(process.arch === "x64" || process.arch === "arm64");
const registryRoot = `Software\\ClineCLIInstallerTests\\${randomUUID()}`;
const environmentKey = `${registryRoot}\\Environment`;
const installKey = `${registryRoot}\\Install`;
const environmentScript = resolve(
	import.meta.dir,
	"windows-installer/environment.ps1",
);
const originalUserPath = process.env.PATH;
const registryPreamble =
	"$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); " +
	"$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64); ";
let testRoot: string;
let setup: string;
let fixture: string;
let originalRegistryPath: { value: string | null; kind: string | null };

function quote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

async function powershell(script: string, path?: string): Promise<string> {
	const encoded = Buffer.from(
		"$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); " +
			(path ? `$env:Path = ${quote(path)}; ` : "") +
			script,
		"utf16le",
	).toString("base64");
	const child = Bun.spawn(
		[
			"powershell.exe",
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			encoded,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
		},
	);
	const [output, error, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`PowerShell exited with ${code}: ${error}`);
	return output.trim();
}

async function resetRegistry(
	pathValue: string | null,
	kind: "String" | "ExpandString" = "ExpandString",
): Promise<void> {
	await powershell(
		`${registryPreamble}$registry.DeleteSubKeyTree(${quote(registryRoot)}, $false); ` +
			`$key = $registry.CreateSubKey(${quote(environmentKey)}); ` +
			(pathValue === null
				? ""
				: `$key.SetValue('Path', ${quote(pathValue)}, [Microsoft.Win32.RegistryValueKind]::${kind}); `) +
			"$key.Dispose(); $registry.Dispose();",
	);
}

async function readPath(key = environmentKey): Promise<{
	value: string | null;
	kind: string | null;
}> {
	return JSON.parse(
		await powershell(
			`${registryPreamble}$key = $registry.OpenSubKey(${quote(key)}); ` +
				"$value = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); " +
				"$kind = $null; if ($null -ne $value) { $kind = $key.GetValueKind('Path').ToString() }; " +
				"@{value = $value; kind = $kind} | ConvertTo-Json -Compress; $key.Dispose(); $registry.Dispose();",
		),
	);
}

async function updatePath(
	action: "Add" | "Remove",
	dir: string,
): Promise<void> {
	await runInstallerCommand([
		"powershell.exe",
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		environmentScript,
		"-Action",
		action,
		"-InstallDir",
		dir,
		"-EnvironmentKey",
		environmentKey,
		"-InstallKey",
		installKey,
	]);
}

async function runSetup(dir: string): Promise<number> {
	return Number(
		await powershell(
			`$process = Start-Process -FilePath ${quote(setup)} -ArgumentList @('/S', ${quote(`/D=${dir}`)}) -WindowStyle Hidden -Wait -PassThru; $process.ExitCode`,
		),
	);
}

async function uninstall(dir: string): Promise<number> {
	// _?= avoids the uninstaller's temporary copy so we wait for its true exit.
	return Number(
		await powershell(
			`$process = Start-Process -FilePath ${quote(join(dir, "Uninstall.exe"))} -ArgumentList @('/S', ${quote(`_?=${dir}`)}) -WindowStyle Hidden -Wait -PassThru; $process.ExitCode`,
		),
	);
}

describe.skipIf(!windows)("Windows CLI installer", () => {
	beforeAll(async () => {
		originalRegistryPath = await readPath("Environment");
		testRoot = mkdtempSync(join(resolve(tmpdir()), "cline-setup-test-"));
		const payload = join(testRoot, "payload $ space");
		mkdirSync(join(payload, "bin"), { recursive: true });
		mkdirSync(join(payload, "cline-hub/webview"), { recursive: true });
		mkdirSync(join(payload, "extensions"), { recursive: true });
		fixture = join(payload, "bin/cline.exe");
		const fixtureSource = join(testRoot, "fixture.ts");
		writeFileSync(
			fixtureSource,
			'if (process.argv.includes("--hold")) { await Bun.write(process.argv.at(-1)!, "ready"); setInterval(() => {}, 1000); } else console.log("1.2.3");',
		);
		await runInstallerCommand([
			process.execPath,
			"build",
			"--compile",
			fixtureSource,
			"--outfile",
			fixture,
		]);
		writeFileSync(join(payload, "cline-hub/webview/index.html"), "hub assets");
		writeFileSync(
			join(payload, "extensions/plugin-sandbox-bootstrap.js"),
			"plugin",
		);
		writeFileSync(join(payload, "package.json"), '{"version":"1.2.3"}');
		setup = join(testRoot, "Cline test setup.exe");
		await buildWindowsInstaller({
			packageDir: payload,
			outputFile: setup,
			arch: process.arch as "arm64" | "x64",
			version: "1.2.3",
			compiler: await findNSISCompiler(),
			environmentKey,
			installKey,
		});
	}, 180_000);

	afterAll(async () => {
		await powershell(
			`${registryPreamble}$registry.DeleteSubKeyTree(${quote(registryRoot)}, $false); $registry.Dispose();`,
		);
		if (testRoot) {
			rmSync(testRoot, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
		}
		expect(process.env.PATH).toBe(originalUserPath);
		expect(await readPath("Environment")).toEqual(originalRegistryPath);
	}, 30_000);

	test("preserves long raw PATH values, their type, and later user edits", async () => {
		const dir = join(testRoot, "long path");
		const binDir = join(dir, "bin");
		const longPath =
			"%USERPROFILE%\\existing;" +
			Array.from({ length: 600 }, (_, index) => `C:\\Tools\\Tool${index}`).join(
				";",
			) +
			";;";
		await resetRegistry(longPath);
		await updatePath("Add", dir);
		await updatePath("Add", dir);
		expect(await readPath()).toEqual({
			value: `${binDir};${longPath}`,
			kind: "ExpandString",
		});
		await powershell(
			`${registryPreamble}$key = $registry.OpenSubKey(${quote(environmentKey)}, $true); ` +
				`$key.SetValue('Path', ${quote(`${binDir};${longPath};C:\\AddedLater`)}, [Microsoft.Win32.RegistryValueKind]::ExpandString); $key.Dispose(); $registry.Dispose();`,
		);
		await updatePath("Remove", dir);
		expect((await readPath()).value).toBe(`${longPath};C:\\AddedLater`);
	}, 30_000);

	test("leaves a preexisting equivalent PATH entry owned by the user", async () => {
		const dir = join(testRoot, "existing path");
		const existingPath = `C:\\Other;${join(dir, "bin").toUpperCase()}\\;`;
		await resetRegistry(existingPath, "String");
		await updatePath("Add", dir);
		await updatePath("Remove", dir);
		expect(await readPath()).toEqual({ value: existingPath, kind: "String" });
	}, 30_000);

	test("removes the PATH value if setup created it", async () => {
		await resetRegistry(null);
		const dir = join(testRoot, "no path");
		await updatePath("Add", dir);
		await updatePath("Remove", dir);
		expect(await readPath()).toEqual({ value: null, kind: null });
	}, 30_000);

	test("installs all assets, reinstalls once in PATH, and preserves user files on uninstall", async () => {
		const dir = join(testRoot, "Cline 'quoted' $ space (unicode \u6d4b\u8bd5)");
		const originalPath = "%USERPROFILE%\\existing;C:\\Other;;";
		await resetRegistry(originalPath);
		expect(await runSetup(dir)).toBe(0);
		expect(readFileSync(join(dir, "bin/cline.exe"))).toEqual(
			readFileSync(fixture),
		);
		expect(
			readFileSync(join(dir, "cline-hub/webview/index.html"), "utf8"),
		).toBe("hub assets");
		expect(
			existsSync(join(dir, "extensions/plugin-sandbox-bootstrap.js")),
		).toBe(true);
		expect(await runSetup(dir)).toBe(0);
		expect((await readPath()).value).toBe(
			`${join(dir, "bin")};${originalPath}`,
		);
		expect(
			await powershell(
				"cline --version",
				`${join(dir, "bin")};${originalUserPath}`,
			),
		).toBe("1.2.3");
		writeFileSync(join(dir, "keep-user-file.txt"), "keep");
		expect(await uninstall(dir)).toBe(0);
		expect((await readPath()).value).toBe(originalPath);
		expect(existsSync(join(dir, "bin/cline.exe"))).toBe(false);
		expect(existsSync(join(dir, "cline-hub/webview/index.html"))).toBe(false);
		expect(readFileSync(join(dir, "keep-user-file.txt"), "utf8")).toBe("keep");
	}, 90_000);

	test("refuses to overwrite a running installed executable", async () => {
		const dir = join(testRoot, "running cline");
		await resetRegistry("C:\\Other");
		expect(await runSetup(dir)).toBe(0);
		const readyFile = join(testRoot, "running-ready");
		const child = Bun.spawn([join(dir, "bin/cline.exe"), "--hold", readyFile], {
			stdout: "ignore",
			stderr: "inherit",
			windowsHide: true,
		});
		try {
			for (
				let attempt = 0;
				attempt < 100 && !existsSync(readyFile);
				attempt++
			) {
				await Bun.sleep(50);
			}
			expect(existsSync(readyFile)).toBe(true);
			expect(await runSetup(dir)).toBe(2);
			expect(child.exitCode).toBeNull();
		} finally {
			child.kill();
			await child.exited;
		}
		writeFileSync(join(dir, "bin/cline.exe"), readFileSync(fixture));
		expect(await uninstall(dir)).toBe(0);
	}, 60_000);
});
