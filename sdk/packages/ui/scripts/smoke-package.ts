import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const importCheck = `
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Conversation, Message } from "@cline/ui/components/agent-chat";

if (!Conversation || !Message) {
	throw new Error("agent-chat exports are missing from the packed package");
}

for (const specifier of [
	"@cline/ui/components/agent-chat.css",
	"@cline/ui/components/markdown.css",
	"@cline/ui/theme/base.css",
	"@cline/ui/theme/index.css",
	"@cline/ui/theme/scoped-tokens.css",
	"@cline/ui/theme/theme.css",
	"@cline/ui/theme/tokens.css",
]) {
	const resolved = fileURLToPath(import.meta.resolve(specifier));
	if (!existsSync(resolved)) {
		throw new Error("packed CSS export does not exist: " + specifier);
	}
}

const packageRoot = dirname(
	fileURLToPath(import.meta.resolve("@cline/ui/package.json")),
);
const license = join(packageRoot, "LICENSE");
if (
	!existsSync(license) ||
	!readFileSync(license, "utf8").includes("Apache License")
) {
	throw new Error("packed package is missing the Apache license text");
}
const declarations = [];
const maps = [];
const pending = [join(packageRoot, "dist")];
while (pending.length > 0) {
	const directory = pending.pop();
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const target = join(directory, entry.name);
		if (entry.isDirectory()) pending.push(target);
		else if (entry.name.endsWith(".d.ts")) declarations.push(target);
		else if (entry.name.endsWith(".map")) maps.push(target);
	}
}
if (declarations.length === 0) {
	throw new Error("packed package contains no TypeScript declarations");
}
if (maps.length === 0) {
	throw new Error("packed package contains no source maps");
}
for (const sourceMapPath of maps) {
	const sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf8"));
	if (
		!Array.isArray(sourceMap.sources) ||
		sourceMap.sources.length === 0 ||
		!sourceMap.sources.every((source) =>
			existsSync(resolve(dirname(sourceMapPath), source)),
		)
	) {
		throw new Error("packed source map has missing sources: " + sourceMapPath);
	}
}
`;

async function run(command: string[], cwd: string): Promise<void> {
	const child = Bun.spawn(command, {
		cwd,
		stderr: "inherit",
		stdout: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(`${command.join(" ")} exited with ${exitCode}`);
	}
}

function createConsumer(root: string): void {
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify({ name: "cline-ui-smoke", private: true, type: "module" }, null, 2)}\n`,
	);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "cline-ui-package-"));

try {
	let archive = process.argv[2] ? resolve(process.argv[2]) : undefined;
	if (!archive) {
		const packDirectory = join(temporaryRoot, "pack");
		mkdirSync(packDirectory, { recursive: true });
		await run(
			[
				process.execPath,
				"pm",
				"pack",
				"--ignore-scripts",
				"--destination",
				packDirectory,
			],
			packageRoot,
		);
		const archiveName = readdirSync(packDirectory).find((name) =>
			name.endsWith(".tgz"),
		);
		if (!archiveName) throw new Error("bun pm pack did not create an archive");
		archive = join(packDirectory, archiveName);
	}

	const bunConsumer = join(temporaryRoot, "bun-consumer");
	createConsumer(bunConsumer);
	await run(
		[process.execPath, "add", "--ignore-scripts", archive, "react@19.2.4"],
		bunConsumer,
	);
	await run([process.execPath, "-e", importCheck], bunConsumer);

	const npmConsumer = join(temporaryRoot, "npm-consumer");
	createConsumer(npmConsumer);
	await run(
		[
			"npm",
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			archive,
			"@types/react@18.3.31",
			"react@18.3.1",
			"typescript@5.9.3",
		],
		npmConsumer,
	);
	await run(["node", "--input-type=module", "-e", importCheck], npmConsumer);
	writeFileSync(
		join(npmConsumer, "index.ts"),
		'import { Conversation, Message } from "@cline/ui/components/agent-chat";\nvoid Conversation;\nvoid Message;\n',
	);
	writeFileSync(
		join(npmConsumer, "tsconfig.json"),
		`${JSON.stringify(
			{
				compilerOptions: {
					module: "NodeNext",
					moduleResolution: "NodeNext",
					noEmit: true,
					skipLibCheck: false,
					strict: true,
					target: "ES2022",
				},
				include: ["index.ts"],
			},
			null,
			2,
		)}\n`,
	);
	await run(
		["node", "node_modules/typescript/bin/tsc", "--project", "tsconfig.json"],
		npmConsumer,
	);
	console.log(
		`Verified packed ${basename(archive)} with Bun/React 19 and npm/Node/React 18`,
	);
} finally {
	rmSync(temporaryRoot, { force: true, recursive: true });
}
