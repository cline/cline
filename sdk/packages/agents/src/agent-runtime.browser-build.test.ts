import { execFile } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../../..");
const llmsRoot = resolve(packageRoot, "../llms");
const sharedRoot = resolve(packageRoot, "../shared");
const require = createRequire(import.meta.url);

function linkSourcePackage(
	tempDir: string,
	scope: string,
	name: string,
	root: string,
	exports: Record<string, unknown>,
): void {
	const packageDir = join(tempDir, "node_modules", scope, name);
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify(
			{
				name: `${scope}/${name}`,
				type: "module",
				exports,
			},
			null,
			2,
		),
	);
	symlinkSync(join(root, "src"), join(packageDir, "src"), "dir");
}

function linkInstalledPackage(tempDir: string, packageName: string): void {
	const parts = packageName.split("/");
	const packageDir = join(tempDir, "node_modules", ...parts);
	mkdirSync(dirname(packageDir), { recursive: true });
	let packageJsonPath: string;
	try {
		packageJsonPath = require.resolve(`${packageName}/package.json`, {
			paths: [packageRoot],
		});
	} catch {
		const bunStore = join(repositoryRoot, "node_modules", ".bun");
		const storePrefix = `${packageName.replace("/", "+")}@`;
		const storeEntry = readdirSync(bunStore).find((entry) =>
			entry.startsWith(storePrefix),
		);
		if (!storeEntry) {
			throw new Error(
				`Unable to resolve package fixture dependency ${packageName}`,
			);
		}
		packageJsonPath = join(
			bunStore,
			storeEntry,
			"node_modules",
			packageName,
			"package.json",
		);
	}
	symlinkSync(dirname(packageJsonPath), packageDir, "dir");
}

describe("AgentRuntime browser bundle", () => {
	it("bundles the browser-safe Agent entry without resolving the llms gateway", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "cline-agents-browser-"));
		try {
			writeFileSync(
				join(tempDir, "package.json"),
				JSON.stringify({ type: "module" }, null, 2),
			);
			writeFileSync(
				join(tempDir, "entry.ts"),
				[
					'import { Agent } from "@cline/agents";',
					"console.log(typeof Agent);",
				].join("\n"),
			);

			linkSourcePackage(tempDir, "@cline", "agents", packageRoot, {
				".": {
					browser: "./src/index.ts",
					import: "./src/index.ts",
				},
			});
			linkSourcePackage(tempDir, "@cline", "llms", llmsRoot, {
				".": {
					browser: "./src/index.browser.ts",
					import: "./src/index.ts",
				},
			});
			linkSourcePackage(tempDir, "@cline", "shared", sharedRoot, {
				".": {
					browser: "./src/index.ts",
					import: "./src/index.ts",
				},
			});
			linkInstalledPackage(tempDir, "nanoid");
			linkInstalledPackage(tempDir, "zod");

			const outfile = join(tempDir, "out.js");
			await execFileAsync(
				"bun",
				[
					"build",
					join(tempDir, "entry.ts"),
					"--target",
					"browser",
					"--conditions",
					"browser",
					"--packages",
					"bundle",
					"--external",
					"@cline/shared",
					"--external",
					"nanoid",
					"--external",
					"zod",
					"--outfile",
					outfile,
				],
				{ cwd: tempDir },
			);

			const output = readFileSync(outfile, "utf8");
			expect(output).not.toContain("@aws-sdk/credential-providers");
			expect(output).not.toContain("@opentelemetry/sdk-trace-node");
			expect(output).not.toContain("vendors/bedrock");

			const { stdout } = await execFileAsync("bun", ["run", outfile], {
				cwd: tempDir,
			});
			expect(stdout.trim()).toBe("function");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
