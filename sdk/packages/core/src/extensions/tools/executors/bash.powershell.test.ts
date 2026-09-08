import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createShellExecutor } from "./bash";

const ctx: AgentToolContext = {
	agentId: "powershell-test",
	conversationId: "powershell-test",
	iteration: 1,
};

const names =
	process.platform === "win32"
		? ["powershell.exe", "pwsh.exe"]
		: ["powershell.exe", "pwsh.exe", "pwsh"];
const shells = names.map((name) => {
	const probe = spawnSync(
		name,
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"[Console]::Write((Get-Process -Id $PID).Path)",
		],
		{ encoding: "utf8", windowsHide: true, timeout: 10_000 },
	);
	const path = probe.status === 0 ? probe.stdout.trim() : undefined;
	if (path) console.info(`PowerShell runtime ${name}: ${path}`);
	if (!path) console.warn(`SKIP PowerShell runtime ${name}: unavailable`);
	return { name, path };
});

// Encode only the enclosing expandable-string layer. Dollar expressions are
// deliberately unescaped, as in the reporter's model-authored command.
function wrap(executable: string, script: string): string {
	return `& '${executable.replaceAll("'", "''")}' -NoLogo -NoProfile -NonInteractive -Command "${script.replaceAll("`", "``").replaceAll('"', '`"')}"`;
}

for (const outer of shells) {
	for (const inner of shells) {
		// Keep the Windows four-pair matrix visible as skips on other hosts,
		// plus the locally runnable pwsh control, not impossible mixed OS pairs.
		if ((outer.name === "pwsh") !== (inner.name === "pwsh")) continue;
		describe.runIf(Boolean(outer.path && inner.path))(
			`PowerShell executor ${outer.name} -> ${inner.name}`,
			() => {
				const executor = createShellExecutor({ shell: outer.name });
				const run = (script: string, context = ctx) =>
					executor(
						wrap(inner.path ?? inner.name, script),
						process.cwd(),
						context,
					);

				it("runs the requested executable and edition with intact script values", async () => {
					const output = await run(
						[
							"$value = 'space 中文'; $dollar = '$literal'; $tick = 'a`b'",
							"$items = @('MyEditForm.cs','other.txt','Validator.cs') | Where-Object { $_ -match 'MyEditForm|Validator' } | ForEach-Object { $_ }",
							"@{ edition = $PSVersionTable.PSEdition; major = $PSVersionTable.PSVersion.Major; executable = (Get-Process -Id $PID).Path; value = $value; dollar = $dollar; tick = $tick; quote = 'say \"hello\"'; items = @($items) } | ConvertTo-Json -Compress",
						].join("\r\n"),
					);
					console.info(`${outer.name} -> ${inner.name}: ${output.trim()}`);
					expect(JSON.parse(output)).toEqual({
						edition: inner.name === "powershell.exe" ? "Desktop" : "Core",
						major: inner.name === "powershell.exe" ? 5 : 7,
						executable: inner.path,
						value: "space 中文",
						dollar: "$literal",
						tick: "a`b",
						quote: 'say "hello"',
						items: ["MyEditForm.cs", "Validator.cs"],
					});
				});

				it("decodes expandable-string escapes in the outer edition", async () => {
					const output = await executor(
						`${inner.name} -NoProfile -Command "[int][char]'\`e'; Write-Output '\`u{4e2d}'"`,
						process.cwd(),
						ctx,
					);
					expect(output.trim().split(/\r?\n/)).toEqual(
						outer.name === "powershell.exe" ? ["101", "u{4e2d}"] : ["27", "中"],
					);
				});

				it("executes the reporter's bare-name pipeline in its cwd and environment", async () => {
					const cwd = await mkdtemp(join(tmpdir(), "cline shell 中文 "));
					try {
						await mkdir(join(cwd, "child"));
						await writeFile(join(cwd, "child", "MyEditForm.cs"), "synthetic");
						await writeFile(join(cwd, "other.txt"), "synthetic");
						const withEnv = createShellExecutor({
							shell: outer.name,
							env: { CLINE_SHELL_TEST: "inherited value" },
						});
						const output = await withEnv(
							`${inner.name} -NoProfile -Command "Get-ChildItem . -Recurse -File | Where-Object { $_.Name -match 'MyEditForm|EditContext|Validator' } | ForEach-Object { $_.FullName }; Write-Output $env:CLINE_SHELL_TEST"`,
							cwd,
							ctx,
						);
						expect(output.trim().split(/\r?\n/)).toEqual([
							join(cwd, "child", "MyEditForm.cs"),
							"inherited value",
						]);
					} finally {
						await rm(cwd, { recursive: true, force: true });
					}
				});

				it("preserves explicit exit codes and fails fast on pipeline errors", async () => {
					await expect(
						run("Write-Output 'before'; exit 7"),
					).rejects.toMatchObject({
						exitCode: 7,
						output: expect.stringContaining("before"),
					});
					await expect(
						run(
							"1..3 | ForEach-Object { Write-Error 'synthetic-error' }; Write-Output 'after'",
						),
					).rejects.toMatchObject({
						exitCode: 1,
						output: expect.not.stringContaining("\nafter"),
					});
					await expect(run("throw 'synthetic-throw'")).rejects.toMatchObject({
						exitCode: 1,
						output: expect.stringContaining("synthetic-throw"),
					});
					expect(
						(await run("param($value = 5) Write-Output $value")).trim(),
					).toBe("5");
				});

				it("keeps long Unicode scripts off the native command line", async () => {
					expect(
						(
							await run(
								`$value = '${"中".repeat(40_000)}'; Write-Output $value.Length`,
							)
						).trim(),
					).toBe("40000");
				});

				it("does not join outer statements or flags across newline boundaries", async () => {
					for (const newline of ["\n", "\r", "\r\n"]) {
						const output = await executor(
							`${inner.name} -NoProfile -Command${newline}"Write-Output 42"`,
							process.cwd(),
							ctx,
						);
						expect(output).toContain("Write-Output 42");
						expect(output).toContain("[stderr]");
					}
					const output = await executor(
						`${inner.name} -NoProfile -Command "Write-Output 'inner'"; Write-Output 'outer'`,
						process.cwd(),
						ctx,
					);
					expect(output.trim().split(/\r?\n/)).toEqual(["inner", "outer"]);
				});

				it("supports recursive edition switches without losing the final executable", async () => {
					const output = await run(
						wrap(
							outer.path ?? outer.name,
							"Write-Output (Get-Process -Id $PID).Path",
						),
					);
					expect(output.trim()).toBe(outer.path);
				});

				it("cancels the selected process through the existing executor", async () => {
					const abort = new AbortController();
					await expect(
						run(
							"Write-Output 'ready'; Start-Sleep -Seconds 30; Write-Output 'after'",
							{
								...ctx,
								signal: abort.signal,
								emitUpdate: (update) => {
									if (
										typeof update === "object" &&
										update !== null &&
										"chunk" in update &&
										typeof update.chunk === "string" &&
										update.chunk.includes("ready")
									)
										abort.abort();
								},
							},
						),
					).rejects.toThrow(/abort/i);
				});
			},
		);
	}
}

// Linux cannot run Windows PowerShell. This still proves that the real executor
// honors an explicit pwsh request instead of spawning the configured shell.
it.runIf(
	process.platform !== "win32" &&
		Boolean(shells.find((shell) => shell.name === "pwsh")?.path),
)(
	"selects installed pwsh even when the configured Windows shell is unavailable",
	async () => {
		const executor = createShellExecutor({ shell: "powershell.exe" });
		expect(
			(
				await executor(
					wrap("pwsh", "Write-Output $PSVersionTable.PSEdition"),
					process.cwd(),
					ctx,
				)
			).trim(),
		).toBe("Core");
	},
);
