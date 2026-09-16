import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// No desktop/SDK build or dependency install needed. Exercise the actual hook
// in an x86 NSIS installer against x64 executables, not a mocked process query.
const windows = process.platform === "win32" && process.arch === "x64";
const nsis =
	process.env.MAKENSIS_PATH ?? "C:/Program Files (x86)/NSIS/makensis.exe";
const hook = path.resolve(
	import.meta.dir,
	"../src-tauri/nsis/installer-hooks.nsh",
);
const children: ChildProcess[] = [];
let root: string;
let fixture: string;
let installer: string;

function nsisString(value: string): string {
	return value.replaceAll("$", "$$").replaceAll('"', '$\\"');
}

function machine(exe: string): number {
	const bytes = readFileSync(exe);
	return bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 4);
}

async function waitFor(check: () => boolean): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (check()) return;
		await Bun.sleep(50);
	}
	throw new Error("Timed out waiting for fixture process");
}

async function run(exe: string, args: string[]): Promise<number> {
	const child = spawn(exe, args, {
		cwd: root,
		stdio: ["ignore", "ignore", "inherit"],
		windowsHide: true,
		// NSIS requires /D= and _?= to be LAST and unquoted, even for spaces.
		windowsVerbatimArguments: args.some(
			(arg) => arg.startsWith("/D=") || arg.startsWith("_?="),
		),
	});
	const timer = setTimeout(() => child.kill(), 90_000);
	try {
		return await new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code) => resolve(code ?? -1));
		});
	} finally {
		clearTimeout(timer);
	}
}

async function start(dir: string, name: string): Promise<ChildProcess> {
	mkdirSync(dir, { recursive: true });
	const exe = path.join(dir, name);
	if (!existsSync(exe)) copyFileSync(fixture, exe);
	const ready = path.join(root, `ready-${children.length}`);
	const child = spawn(exe, [ready], {
		detached: true,
		windowsHide: true,
		stdio: "ignore",
	});
	children.push(child);
	await waitFor(() => existsSync(ready));
	return child;
}

describe.skipIf(!windows)("Windows installer process cleanup", () => {
	beforeAll(async () => {
		if (!existsSync(nsis))
			throw new Error(`Set MAKENSIS_PATH: not found: ${nsis}`);
		root = mkdtempSync(path.join(tmpdir(), "cline-installer-test-"));
		fixture = path.join(root, "fixture.exe");
		const source = path.join(root, "fixture.ts");
		writeFileSync(
			source,
			'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "ready"); setInterval(() => {}, 1000);',
		);
		expect(
			await run(process.execPath, [
				"build",
				"--compile",
				"--target=bun-windows-x64",
				source,
				"--outfile",
				fixture,
			]),
		).toBe(0);
		expect(machine(fixture)).toBe(0x8664);

		installer = path.join(root, "setup.exe");
		const script = path.join(root, "installer.nsi");
		// Match Tauri's ordering: hooks are included BEFORE MAINBINARYNAME is
		// defined. Both hooks must compile and preserve caller registers.
		writeFileSync(
			script,
			`
Unicode true
RequestExecutionLevel user
!include FileFunc.nsh
!include "${nsisString(hook)}"
!define MAINBINARYNAME "cline-app"
Name "Cline cleanup test"
OutFile "${nsisString(installer)}"
Page instfiles
AutoCloseWindow true
Function .onInstFailed
  StrCmp $0 "preserved" +3
    SetErrorLevel 6
    Return
  Pop $0
  StrCmp $0 "sentinel" +2
    SetErrorLevel 7
FunctionEnd
Section
  Push "sentinel"
  StrCpy $0 "preserved"
  !insertmacro NSIS_HOOK_PREINSTALL
  StrCmp $0 "preserved" +3
    SetErrorLevel 3
    Quit
  CreateDirectory "$INSTDIR"
  ClearErrors
  FileOpen $0 "$INSTDIR\\code-sidecar.exe" w
  IfErrors 0 +3
    SetErrorLevel 4
    Quit
  FileWrite $0 "replaced"
  FileClose $0
  WriteUninstaller "$INSTDIR\\uninstall.exe"
  Pop $0
SectionEnd
Section "Uninstall"
  !insertmacro NSIS_HOOK_PREUNINSTALL
  ClearErrors
  Delete "$INSTDIR\\code-sidecar.exe"
  Delete "$INSTDIR\\cline-app.exe"
  IfErrors 0 +2
    SetErrorLevel 5
SectionEnd
`,
		);
		expect(await run(nsis, ["/V2", script])).toBe(0);
		expect(machine(installer)).toBe(0x14c);
	}, 120_000);

	afterAll(async () => {
		for (const child of children) {
			if (child.exitCode === null && child.signalCode === null) child.kill();
		}
		await waitFor(() =>
			children.every((p) => p.exitCode !== null || p.signalCode !== null),
		);
		if (root)
			rmSync(root, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
	});

	test("first install and repeated cleanup succeed with no running processes", async () => {
		const dir = path.join(root, "fresh install");
		expect(await run(installer, ["/S", `/D=${dir}`])).toBe(0);
		expect(await run(installer, ["/S", `/D=${dir}`])).toBe(0);
		expect(readFileSync(path.join(dir, "code-sidecar.exe"), "utf8")).toBe(
			"replaced",
		);
	}, 120_000);

	test("stops all target x64 processes, releases the file, and preserves another install", async () => {
		const dir = path.join(root, "Cline 'quoted' $ space (测试)");
		const beta = await start(`${dir} Beta`, "code-sidecar.exe");
		const targets = [
			await start(dir, "cline-app.exe"),
			await start(dir, "code-sidecar.exe"),
			await start(dir, "code-sidecar.exe"),
		];
		// Windows must actually have the executable locked before the test.
		expect(() =>
			writeFileSync(path.join(dir, "code-sidecar.exe"), "locked"),
		).toThrow();
		expect(await run(installer, ["/S", `/D=${dir}`])).toBe(0);
		await waitFor(() =>
			targets.every((p) => p.exitCode !== null || p.signalCode !== null),
		);
		expect(readFileSync(path.join(dir, "code-sidecar.exe"), "utf8")).toBe(
			"replaced",
		);
		expect(beta.exitCode).toBeNull();
		expect(beta.signalCode).toBeNull();
	}, 120_000);

	test("uninstaller releases the same files before deleting them", async () => {
		const dir = path.join(root, "uninstall");
		expect(await run(installer, ["/S", `/D=${dir}`])).toBe(0);
		copyFileSync(fixture, path.join(dir, "code-sidecar.exe"));
		const target = await start(dir, "code-sidecar.exe");
		// _?= disables NSIS's temp-copy trampoline so we wait for the real exit.
		expect(
			await run(path.join(dir, "uninstall.exe"), ["/S", `_?=${dir}`]),
		).toBe(0);
		await waitFor(() => target.exitCode !== null || target.signalCode !== null);
		expect(existsSync(path.join(dir, "code-sidecar.exe"))).toBe(false);
	}, 120_000);

	// Only silent mode is automatable: passive (/P, what the Tauri updater
	// uses) and interactive installs show a Retry/Cancel dialog here instead.
	test("silent install fails closed without a write on Restart Manager error", async () => {
		const dir = path.join(root, "failure");
		// RmRegisterResources rejects directories with ERROR_ACCESS_DENIED.
		// This exercises a real native error, not an injected API mock.
		mkdirSync(path.join(dir, "cline-app.exe"), { recursive: true });
		writeFileSync(path.join(dir, "code-sidecar.exe"), "untouched");
		expect(await run(installer, ["/S", `/D=${dir}`])).toBe(2);
		expect(readFileSync(path.join(dir, "code-sidecar.exe"), "utf8")).toBe(
			"untouched",
		);
		expect(existsSync(path.join(dir, "uninstall.exe"))).toBe(false);
	}, 120_000);
});
