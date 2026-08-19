import { createHash } from "node:crypto";
import {
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type { AgendaTaskScope } from "@cline/shared";
import { resolveTaskSpecsDir } from "@cline/shared/storage";
import {
	type AgendaTaskSpec,
	type AgendaTaskSpecParseResult,
	type AgendaTaskSpecWriteInput,
	parseAgendaTaskSpec,
	serializeAgendaTaskSpec,
} from "./task-spec-parser";

export interface AgendaTaskSpecFileStoreOptions {
	scope: AgendaTaskScope;
	workspaceRoot?: string;
	taskSpecsDir?: string;
}

export interface WriteAgendaTaskSpecOptions {
	/** Existing path or a filename under this store's directory. */
	specPath?: string;
	/** Refuse to replace a file whose parsed content changed since it was read. */
	expectedContentHash?: string;
	/** Atomically fail instead of replacing an existing target. */
	createOnly?: boolean;
}

export type WrittenAgendaTaskSpec = AgendaTaskSpec & { taskId: string };

function safeTaskFilename(taskId: string): string {
	const trimmed = taskId.trim();
	const normalized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
	if (!normalized) {
		throw new Error("taskId must contain at least one filename-safe character");
	}
	if (normalized === trimmed) {
		return `${normalized}.task.md`;
	}
	// Sanitizing is lossy ("foo/bar" and "foo-bar" both map to "foo-bar"), so
	// altered ids carry a digest of the raw id to keep distinct ids on
	// distinct spec files.
	const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 8);
	return `${normalized}-${digest}.task.md`;
}

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return (
		rel === "" ||
		(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
	);
}

export class AgendaTaskSpecFileStore {
	public readonly specsDir: string;
	public readonly scope: AgendaTaskScope;
	public readonly workspaceRoot?: string;

	constructor(options: AgendaTaskSpecFileStoreOptions) {
		this.scope = options.scope;
		this.workspaceRoot = options.workspaceRoot?.trim() || undefined;
		this.specsDir = resolve(
			resolveTaskSpecsDir({
				scope: options.scope,
				workspaceRoot: this.workspaceRoot,
				taskSpecsDir: options.taskSpecsDir,
			}),
		);
	}

	public listSpecPaths(): string[] {
		if (!existsSync(this.specsDir)) return [];
		this.assertSpecsDirSafe();
		return readdirSync(this.specsDir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".task.md"))
			.map((entry) => join(this.specsDir, entry.name))
			.sort((left, right) => left.localeCompare(right));
	}

	public listSpecs(): AgendaTaskSpecParseResult[] {
		return this.listSpecPaths().map((path) => {
			try {
				return this.readSpec(path);
			} catch (error) {
				return {
					ok: false,
					specPath: path,
					contentHash: "",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});
	}

	public readSpec(specPath: string): AgendaTaskSpecParseResult {
		this.assertSpecsDirSafe();
		const path = this.resolveSpecPath(specPath);
		if (lstatSync(path).isSymbolicLink()) {
			throw new Error("task spec files cannot be symbolic links");
		}
		return parseAgendaTaskSpec({
			specPath: path,
			raw: readFileSync(path, "utf8"),
			scope: this.scope,
			workspaceRoot: this.workspaceRoot,
		});
	}

	public writeSpec(
		input: AgendaTaskSpecWriteInput,
		options: WriteAgendaTaskSpecOptions = {},
	): WrittenAgendaTaskSpec {
		if (!input.taskId.trim()) throw new Error("taskId is required");
		this.ensureSpecsDir();
		const target = this.resolveWritePath(input.taskId, options.specPath);
		if (options.createOnly && existsSync(target)) {
			throw new Error(`task spec already exists: ${target}`);
		}
		if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
			throw new Error("task spec files cannot be symbolic links");
		}
		const raw = serializeAgendaTaskSpec({
			...input,
			cwd: this.portableSpecCwd(input.cwd),
		});
		const validated = parseAgendaTaskSpec({
			specPath: target,
			raw,
			scope: this.scope,
			workspaceRoot: this.workspaceRoot,
		});
		if (!validated.ok) {
			throw new Error(`invalid task spec: ${validated.error}`);
		}
		const temporaryPath = join(
			this.specsDir,
			`.${basename(target)}.${process.pid}.${Date.now()}.tmp`,
		);
		try {
			writeFileSync(temporaryPath, raw, {
				encoding: "utf8",
				mode: 0o600,
			});
			this.assertExpectedContent(target, options);
			if (options.createOnly) {
				linkSync(temporaryPath, target);
			} else {
				renameSync(temporaryPath, target);
			}
		} finally {
			if (existsSync(temporaryPath)) {
				rmSync(temporaryPath, { force: true });
			}
		}
		return validated.spec as WrittenAgendaTaskSpec;
	}

	/** Resolve the canonical target before a manager reserves it in SQLite. */
	public resolveWritePath(taskId: string, specPath?: string): string {
		return this.resolveSpecPath(specPath ?? safeTaskFilename(taskId));
	}

	/** Validate the root both before and after creating missing directories. */
	public ensureSpecsDir(): void {
		this.assertSpecsDirSafe();
		mkdirSync(this.specsDir, { recursive: true });
		this.assertSpecsDirSafe();
		this.ensureWorkspaceGitignore();
	}

	/**
	 * Spec files carry machine-local task ids and expiry state, so keep
	 * `<workspace>/.cline/tasks/` out of version control by default. Teams
	 * that want to commit and share specs can edit or empty this file; an
	 * existing file is never overwritten.
	 */
	private ensureWorkspaceGitignore(): void {
		if (this.scope !== "workspace") return;
		const gitignorePath = join(this.specsDir, ".gitignore");
		if (existsSync(gitignorePath)) return;
		try {
			writeFileSync(gitignorePath, "*\n", { encoding: "utf8", flag: "wx" });
		} catch {
			// A concurrent writer already created the file; either copy wins.
		}
	}

	/**
	 * Serialize `cwd` workspace-relative (POSIX separators) so a committed
	 * spec stays valid on machines that check the workspace out elsewhere.
	 * Paths that escape the workspace pass through unchanged so validation
	 * reports them with the caller's original value.
	 */
	private portableSpecCwd(cwd: string | undefined): string | undefined {
		const trimmed = cwd?.trim();
		if (!trimmed) return undefined;
		if (this.scope !== "workspace" || !this.workspaceRoot) return trimmed;
		const workspaceRoot = resolve(this.workspaceRoot);
		const candidate = resolve(workspaceRoot, trimmed);
		if (!isContained(workspaceRoot, candidate)) return trimmed;
		const relativeCwd = relative(workspaceRoot, candidate);
		return relativeCwd === "" ? "." : relativeCwd.split(sep).join("/");
	}

	public deleteSpec(
		specPath: string,
		options: { expectedContentHash?: string } = {},
	): boolean {
		this.assertSpecsDirSafe();
		const path = this.resolveSpecPath(specPath);
		if (!existsSync(path)) return false;
		if (options.expectedContentHash) {
			const current = this.readSpec(path);
			if (current.contentHash !== options.expectedContentHash) {
				throw new Error(`task spec changed before delete: ${path}`);
			}
		}
		rmSync(path);
		return true;
	}

	private assertExpectedContent(
		target: string,
		options: WriteAgendaTaskSpecOptions,
	): void {
		if (options.createOnly) {
			if (existsSync(target)) {
				throw new Error(`task spec already exists: ${target}`);
			}
			return;
		}
		if (!options.expectedContentHash) return;
		if (!existsSync(target)) {
			throw new Error(`task spec disappeared before update: ${target}`);
		}
		const current = this.readSpec(target);
		if (current.contentHash !== options.expectedContentHash) {
			throw new Error(`task spec changed before update: ${target}`);
		}
	}

	private assertSpecsDirSafe(): void {
		if (
			existsSync(this.specsDir) &&
			lstatSync(this.specsDir).isSymbolicLink()
		) {
			throw new Error("task specs directory cannot be a symbolic link");
		}
		if (!this.workspaceRoot || !existsSync(this.workspaceRoot)) return;
		const canonicalWorkspace = realpathSync(this.workspaceRoot);
		let existing = this.specsDir;
		while (!existsSync(existing)) {
			const parent = dirname(existing);
			if (parent === existing) break;
			existing = parent;
		}
		if (
			existsSync(existing) &&
			!isContained(canonicalWorkspace, realpathSync(existing))
		) {
			throw new Error("task specs directory escapes the workspace");
		}
	}

	private resolveSpecPath(input: string): string {
		const target = resolve(
			isAbsolute(input) ? input : join(this.specsDir, input),
		);
		const fromRoot = relative(this.specsDir, target);
		if (
			fromRoot === "" ||
			fromRoot.startsWith("..") ||
			isAbsolute(fromRoot) ||
			!target.endsWith(".task.md")
		) {
			throw new Error(
				"task spec path must be a *.task.md file within the specs directory",
			);
		}
		return target;
	}
}
