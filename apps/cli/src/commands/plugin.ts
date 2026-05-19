import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	type Dirent,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
	isPluginModulePath,
	resolveClineDir,
	resolvePluginModuleEntries,
} from "@cline/shared/storage";

export interface PluginInstallOptions {
	source: string;
	sourceType?: PluginInstallSourceType;
	cwd?: string;
	force?: boolean;
	npmCommand?: string;
	io?: PluginInstallIo;
}

export interface PluginInstallResult {
	source: string;
	installPath: string;
	entryPaths: string[];
}

export interface PluginInstallIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

type ParsedPluginSource =
	| {
			type: "npm";
			spec: string;
			name: string;
	  }
	| {
			type: "git";
			repo: string;
			ref?: string;
			host: string;
			path: string;
	  }
	| {
			type: "local";
			path: string;
	  };

type PluginInstallSourceType = "npm" | "git" | "local";

interface PluginPackageManifest {
	cline?: {
		plugins?: Array<{ paths?: string[] } | string>;
	};
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, unknown>;
}

const INSTALLS_DIRECTORY_NAME = "_installed";
const PACKAGE_DIRECTORY_NAME = "package";
const HOST_PROVIDED_SDK_PREFIX = "@cline/";
const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;
const WRAPPER_PACKAGE_JSON = {
	name: "cline-installed-plugin",
	private: true,
	cline: {
		plugins: [] as Array<{ paths: string[] }>,
	},
};

function resolveHomePath(value: string): string {
	if (value === "~") {
		return homedir();
	}
	if (value.startsWith("~/")) {
		return join(homedir(), value.slice(2));
	}
	return value;
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function hashSource(source: string): string {
	return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function sanitizeSegment(value: string): string {
	const sanitized = value
		.replace(/^@/, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return sanitized || "plugin";
}

function parseNpmSpec(spec: string): { name: string } {
	const trimmed = spec.trim();
	const match = trimmed.match(/^(@?[^@/]+(?:\/[^@/]+)?)(?:@.+)?$/);
	if (!match?.[1]) {
		throw new Error(`Invalid npm plugin source: npm:${spec}`);
	}
	return { name: match[1] };
}

function looksLikeHostnamePath(source: string): boolean {
	if (
		source.startsWith(".") ||
		source.startsWith("/") ||
		source === "~" ||
		source.startsWith("~/") ||
		/^[A-Za-z]:[\\/]|^\\\\/.test(source)
	) {
		return false;
	}
	const [host, ...pathParts] = source.split("/");
	return (
		!!host &&
		pathParts.length >= 2 &&
		host.includes(".") &&
		!host.startsWith(".") &&
		!host.endsWith(".")
	);
}

function splitGitRef(input: string): { repo: string; ref?: string } {
	const scpLike = input.match(/^git@([^:]+):(.+)$/);
	if (scpLike) {
		const path = scpLike[2] ?? "";
		const refAt = path.indexOf("@");
		if (refAt < 0) {
			return { repo: input };
		}
		return {
			repo: `git@${scpLike[1]}:${path.slice(0, refAt)}`,
			ref: path.slice(refAt + 1) || undefined,
		};
	}
	if (input.includes("://")) {
		try {
			const parsed = new URL(input);
			const path = parsed.pathname.replace(/^\/+/, "");
			const refAt = path.indexOf("@");
			if (refAt < 0) {
				return { repo: input };
			}
			parsed.pathname = `/${path.slice(0, refAt)}`;
			return {
				repo: parsed.toString().replace(/\/$/, ""),
				ref: path.slice(refAt + 1) || undefined,
			};
		} catch {
			return { repo: input };
		}
	}
	const slash = input.indexOf("/");
	if (slash < 0) {
		return { repo: input };
	}
	const host = input.slice(0, slash);
	const path = input.slice(slash + 1);
	const refAt = path.indexOf("@");
	if (refAt < 0) {
		return { repo: input };
	}
	return {
		repo: `${host}/${path.slice(0, refAt)}`,
		ref: path.slice(refAt + 1) || undefined,
	};
}

function parseGitSource(
	source: string,
	options: { force?: boolean } = {},
): ParsedPluginSource | null {
	const trimmed = source.trim();
	const hasGitPrefix =
		trimmed.startsWith("git:") && !trimmed.startsWith("git://");
	const raw = hasGitPrefix ? trimmed.slice("git:".length).trim() : trimmed;
	if (!options.force && !hasGitPrefix && !/^(https?|ssh|git):\/\//i.test(raw)) {
		return null;
	}
	const { repo, ref } = splitGitRef(raw);
	let host = "";
	let repoPath = "";
	if (repo.startsWith("git@")) {
		const match = repo.match(/^git@([^:]+):(.+)$/);
		host = match?.[1] ?? "";
		repoPath = match?.[2] ?? "";
	} else if (/^(https?|ssh|git):\/\//i.test(repo)) {
		const parsed = new URL(repo);
		host = parsed.hostname;
		repoPath = parsed.pathname.replace(/^\/+/, "");
	} else {
		const slash = repo.indexOf("/");
		if (slash < 0) {
			return null;
		}
		host = repo.slice(0, slash);
		repoPath = repo.slice(slash + 1);
	}
	const normalizedPath = repoPath.replace(/\.git$/, "").replace(/^\/+/, "");
	if (!host || !normalizedPath || normalizedPath.split("/").length < 2) {
		return null;
	}
	const cloneRepo =
		repo.startsWith("git@") || /^(https?|ssh|git):\/\//i.test(repo)
			? repo
			: `https://${repo}`;
	return {
		type: "git",
		repo: cloneRepo,
		ref,
		host,
		path: normalizedPath,
	};
}

export function parsePluginSource(
	source: string,
	sourceType?: PluginInstallSourceType,
): ParsedPluginSource {
	const trimmed = source.trim();
	if (!trimmed) {
		throw new Error("plugin install requires a source");
	}
	if (sourceType === "npm") {
		const spec = trimmed.startsWith("npm:")
			? trimmed.slice("npm:".length).trim()
			: trimmed;
		const { name } = parseNpmSpec(spec);
		return { type: "npm", spec, name };
	}
	if (sourceType === "git") {
		const git = parseGitSource(trimmed, { force: true });
		if (!git) {
			throw new Error(`Invalid git plugin source: ${source}`);
		}
		return git;
	}
	if (sourceType === "local") {
		return { type: "local", path: source };
	}
	if (trimmed.startsWith("npm:")) {
		const spec = trimmed.slice("npm:".length).trim();
		const { name } = parseNpmSpec(spec);
		return { type: "npm", spec, name };
	}
	const localPathLike =
		trimmed.startsWith(".") ||
		trimmed.startsWith("/") ||
		trimmed === "~" ||
		trimmed.startsWith("~/") ||
		/^[A-Za-z]:[\\/]|^\\\\/.test(trimmed);
	if (localPathLike) {
		return { type: "local", path: source };
	}
	const git = parseGitSource(trimmed);
	if (git) {
		return git;
	}
	if (looksLikeHostnamePath(trimmed)) {
		throw new Error(
			`Unrecognized plugin source "${source}". Use --git for hostname-style repositories or pass an explicit local path such as ./github.com/owner/repo.`,
		);
	}
	return { type: "local", path: source };
}

function getPluginRoot(cwd: string | undefined): string {
	return cwd
		? join(cwd, ".cline", "plugins")
		: join(resolveClineDir(), "plugins");
}

function getInstallPath(
	pluginRoot: string,
	parsed: ParsedPluginSource,
	sourceKey: string,
): string {
	if (parsed.type === "npm") {
		return join(
			pluginRoot,
			INSTALLS_DIRECTORY_NAME,
			"npm",
			`${sanitizeSegment(parsed.name)}-${hashSource(sourceKey)}`,
		);
	}
	if (parsed.type === "git") {
		return join(
			pluginRoot,
			INSTALLS_DIRECTORY_NAME,
			"git",
			sanitizeSegment(parsed.host),
			`${sanitizeSegment(parsed.path)}-${hashSource(sourceKey)}`,
		);
	}
	return join(
		pluginRoot,
		INSTALLS_DIRECTORY_NAME,
		"local",
		`${sanitizeSegment(basename(resolveHomePath(parsed.path)))}-${hashSource(sourceKey)}`,
	);
}

function getInstallSourceKey(parsed: ParsedPluginSource, cwd: string): string {
	if (parsed.type === "npm") {
		return `npm:${parsed.spec}`;
	}
	if (parsed.type === "git") {
		return `git:${parsed.repo}${parsed.ref ? `#${parsed.ref}` : ""}`;
	}
	return `local:${resolve(cwd, resolveHomePath(parsed.path))}`;
}

async function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string } = {},
): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "ignore", "pipe"],
			env: process.env,
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			const details = stderr.trim();
			reject(
				new Error(
					`${command} ${args.join(" ")} failed with exit code ${code}${details ? `: ${details}` : ""}`,
				),
			);
		});
	});
}

function readPackageManifest(
	packageRoot: string,
): PluginPackageManifest | null {
	const packageJsonPath = join(packageRoot, "package.json");
	if (!existsSync(packageJsonPath)) {
		return null;
	}
	try {
		return JSON.parse(
			readFileSync(packageJsonPath, "utf8"),
		) as PluginPackageManifest;
	} catch {
		return null;
	}
}

function getManifestPaths(manifest: PluginPackageManifest | null): string[] {
	const entries = manifest?.cline?.plugins;
	if (!Array.isArray(entries)) {
		return [];
	}
	return entries.flatMap((entry) => {
		if (typeof entry === "string") {
			return [entry];
		}
		return entry.paths ?? [];
	});
}

async function removeHostProvidedSdkDependencies(
	packageRoot: string,
): Promise<void> {
	const packageJsonPath = join(packageRoot, "package.json");
	const manifest = readPackageManifest(packageRoot);
	if (!manifest) {
		return;
	}
	let changed = false;
	for (const field of DEPENDENCY_FIELDS) {
		const dependencies = manifest[field];
		if (!dependencies || typeof dependencies !== "object") {
			continue;
		}
		for (const dependencyName of Object.keys(dependencies)) {
			if (!dependencyName.startsWith(HOST_PROVIDED_SDK_PREFIX)) {
				continue;
			}
			delete dependencies[dependencyName];
			delete manifest.peerDependenciesMeta?.[dependencyName];
			changed = true;
		}
		if (Object.keys(dependencies).length === 0) {
			delete manifest[field];
		}
	}
	if (manifest.peerDependenciesMeta) {
		for (const dependencyName of Object.keys(manifest.peerDependenciesMeta)) {
			if (!dependencyName.startsWith(HOST_PROVIDED_SDK_PREFIX)) {
				continue;
			}
			delete manifest.peerDependenciesMeta[dependencyName];
			changed = true;
		}
		if (Object.keys(manifest.peerDependenciesMeta).length === 0) {
			delete manifest.peerDependenciesMeta;
		}
	}
	if (!changed) {
		return;
	}
	await writeFile(
		packageJsonPath,
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
}

function removeInstalledHostProvidedSdkDependencies(
	packageRoot: string,
	preservePackageName?: string,
): void {
	const clineScopeDir = join(packageRoot, "node_modules", "@cline");
	if (!existsSync(clineScopeDir)) {
		return;
	}
	for (const entry of statSafeReadDir(clineScopeDir)) {
		const packageName = `@cline/${entry.name}`;
		if (packageName === preservePackageName) {
			continue;
		}
		rmSync(join(clineScopeDir, entry.name), {
			recursive: true,
			force: true,
		});
	}
}

function collectPluginEntries(packageRoot: string): string[] {
	const manifestPaths = getManifestPaths(readPackageManifest(packageRoot))
		.map((entry) => resolve(packageRoot, entry))
		.filter(
			(entry) =>
				existsSync(entry) &&
				statSync(entry).isFile() &&
				isPluginModulePath(entry),
		);
	if (manifestPaths.length > 0) {
		return manifestPaths;
	}
	const directEntries = resolvePluginModuleEntries(packageRoot);
	if (directEntries?.length) {
		return directEntries;
	}
	const entries: string[] = [];
	const stack = [packageRoot];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of statSafeReadDir(current)) {
			const entryPath = join(current, entry.name);
			if (entry.name === "node_modules" || entry.name === ".git") {
				continue;
			}
			if (entry.isDirectory()) {
				stack.push(entryPath);
				continue;
			}
			if (
				entry.isFile() &&
				!entry.name.startsWith(".") &&
				isPluginModulePath(entryPath)
			) {
				entries.push(entryPath);
			}
		}
	}
	return entries.sort((left, right) => left.localeCompare(right));
}

function statSafeReadDir(dir: string): Dirent[] {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function toWrapperEntryPaths(
	wrapperRoot: string,
	packageRoot: string,
): string[] {
	const entries = collectPluginEntries(packageRoot);
	if (entries.length === 0) {
		throw new Error(`No plugin entry files found in ${packageRoot}`);
	}
	return entries.map(
		(entry) => `./${toPosixPath(relative(wrapperRoot, entry))}`,
	);
}

async function writeWrapperManifest(
	wrapperRoot: string,
	packageRoot: string,
): Promise<string[]> {
	const entryPaths = toWrapperEntryPaths(wrapperRoot, packageRoot);
	await writeFile(
		join(wrapperRoot, "package.json"),
		JSON.stringify(
			{
				...WRAPPER_PACKAGE_JSON,
				name: `cline-installed-plugin-${hashSource(wrapperRoot)}`,
				cline: {
					plugins: [{ paths: entryPaths }],
				},
			},
			null,
			2,
		),
		"utf8",
	);
	return entryPaths;
}

async function installNpmPackage(
	parsed: Extract<ParsedPluginSource, { type: "npm" }>,
	stagingRoot: string,
	npmCommand: string,
): Promise<string> {
	const packageRoot = join(stagingRoot, PACKAGE_DIRECTORY_NAME);
	await mkdir(packageRoot, { recursive: true });
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({ name: "cline-plugin-install", private: true }, null, 2),
		"utf8",
	);
	await runCommand(npmCommand, [
		"install",
		parsed.spec,
		"--prefix",
		packageRoot,
		"--omit=dev",
		"--omit=peer",
		"--no-audit",
		"--no-fund",
		"--package-lock=false",
	]);
	removeInstalledHostProvidedSdkDependencies(packageRoot, parsed.name);
	return join(packageRoot, "node_modules", parsed.name);
}

async function installPackageDependencies(
	packageRoot: string,
	npmCommand: string,
): Promise<void> {
	if (!existsSync(join(packageRoot, "package.json"))) {
		return;
	}
	await removeHostProvidedSdkDependencies(packageRoot);
	await runCommand(
		npmCommand,
		[
			"install",
			"--omit=dev",
			"--no-audit",
			"--no-fund",
			"--package-lock=false",
		],
		{ cwd: packageRoot },
	);
}

async function installGitPackage(
	parsed: Extract<ParsedPluginSource, { type: "git" }>,
	stagingRoot: string,
	npmCommand: string,
): Promise<string> {
	const packageRoot = join(stagingRoot, PACKAGE_DIRECTORY_NAME);
	const cloneArgs = ["clone", "--filter=blob:none"];
	if (parsed.ref) {
		cloneArgs.push("--branch", parsed.ref);
	}
	cloneArgs.push(parsed.repo, packageRoot);
	try {
		await runCommand("git", cloneArgs);
	} catch (error) {
		if (!parsed.ref) {
			throw error;
		}
		await runCommand("git", [
			"clone",
			"--filter=blob:none",
			parsed.repo,
			packageRoot,
		]);
		await runCommand("git", ["checkout", parsed.ref], { cwd: packageRoot });
	}
	await installPackageDependencies(packageRoot, npmCommand);
	return packageRoot;
}

async function installLocalPackage(
	parsed: Extract<ParsedPluginSource, { type: "local" }>,
	stagingRoot: string,
	cwd: string,
	npmCommand: string,
): Promise<string> {
	const absolutePath = resolve(cwd, resolveHomePath(parsed.path));
	if (!existsSync(absolutePath)) {
		throw new Error(`Plugin source path does not exist: ${absolutePath}`);
	}
	const stats = statSync(absolutePath);
	if (stats.isFile()) {
		if (!isPluginModulePath(absolutePath)) {
			throw new Error(`Plugin file must be .js or .ts: ${absolutePath}`);
		}
		mkdirSync(stagingRoot, { recursive: true });
		const targetPath = join(stagingRoot, basename(absolutePath));
		await cp(absolutePath, targetPath);
		return stagingRoot;
	}
	if (!stats.isDirectory()) {
		throw new Error(
			`Plugin source must be a file or directory: ${absolutePath}`,
		);
	}
	const packageRoot = join(stagingRoot, PACKAGE_DIRECTORY_NAME);
	await cp(absolutePath, packageRoot, {
		recursive: true,
		filter: (sourcePath) => {
			const name = basename(sourcePath);
			return name !== ".git" && name !== "node_modules";
		},
	});
	await installPackageDependencies(packageRoot, npmCommand);
	return packageRoot;
}

function assertCanInstall(targetPath: string, force: boolean): void {
	if (existsSync(targetPath) && !force) {
		throw new Error(
			`Plugin is already installed at ${targetPath}. Use --force to replace it.`,
		);
	}
}

function replaceInstallPath(
	stagingRoot: string,
	installPath: string,
	force: boolean,
): void {
	mkdirSync(dirname(installPath), { recursive: true });
	if (!existsSync(installPath)) {
		renameSync(stagingRoot, installPath);
		return;
	}
	if (!force) {
		throw new Error(
			`Plugin is already installed at ${installPath}. Use --force to replace it.`,
		);
	}

	const backupPath = join(
		dirname(installPath),
		`.replace-${basename(installPath)}-${Date.now()}-${process.pid}-${hashSource(
			`${installPath}:${Math.random()}`,
		)}`,
	);
	renameSync(installPath, backupPath);
	try {
		renameSync(stagingRoot, installPath);
	} catch (error) {
		if (!existsSync(installPath) && existsSync(backupPath)) {
			renameSync(backupPath, installPath);
		}
		throw error;
	}
	try {
		rmSync(backupPath, { recursive: true, force: true });
	} catch {
		// The replacement already succeeded; leftover backup cleanup is best effort.
	}
}

export async function installPlugin(
	options: PluginInstallOptions,
): Promise<PluginInstallResult> {
	const source = options.source.trim();
	const parsed = parsePluginSource(source, options.sourceType);
	const explicitCwd = options.cwd?.trim();
	const cwd = explicitCwd ? resolve(explicitCwd) : process.cwd();
	const pluginRoot = getPluginRoot(explicitCwd ? cwd : undefined);
	const sourceKey = getInstallSourceKey(parsed, cwd);
	const installPath = getInstallPath(pluginRoot, parsed, sourceKey);
	const stagingParent = join(pluginRoot, INSTALLS_DIRECTORY_NAME, ".tmp");
	const stagingRoot = join(
		stagingParent,
		`${Date.now()}-${process.pid}-${hashSource(`${source}:${Math.random()}`)}`,
	);
	const npmCommand =
		options.npmCommand ?? (process.env.CLINE_NPM_COMMAND?.trim() || "npm");

	const force = options.force === true;
	assertCanInstall(installPath, force);
	await mkdir(stagingParent, { recursive: true });

	let packageRoot: string;
	try {
		if (parsed.type === "npm") {
			packageRoot = await installNpmPackage(parsed, stagingRoot, npmCommand);
		} else if (parsed.type === "git") {
			packageRoot = await installGitPackage(parsed, stagingRoot, npmCommand);
		} else {
			packageRoot = await installLocalPackage(
				parsed,
				stagingRoot,
				cwd,
				npmCommand,
			);
		}

		const entryPaths =
			parsed.type === "local" && packageRoot === stagingRoot
				? collectPluginEntries(stagingRoot).map(
						(entry) => `./${toPosixPath(relative(stagingRoot, entry))}`,
					)
				: await writeWrapperManifest(stagingRoot, packageRoot);
		if (entryPaths.length === 0) {
			throw new Error(`No plugin entry files found for ${source}`);
		}

		replaceInstallPath(stagingRoot, installPath, force);
		return {
			source,
			installPath,
			entryPaths: entryPaths.map((entry) => resolve(installPath, entry)),
		};
	} catch (error) {
		rmSync(stagingRoot, { recursive: true, force: true });
		throw error;
	}
}

export async function runPluginInstallCommand(
	options: PluginInstallOptions & { json?: boolean },
): Promise<number> {
	try {
		const result = await installPlugin(options);
		if (options.json) {
			process.stdout.write(JSON.stringify(result));
			return 0;
		}
		options.io?.writeln(`Installed plugin from ${result.source}`);
		options.io?.writeln(`  Path: ${result.installPath}`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}
