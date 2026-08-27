import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import {
	WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH,
	WORKSPACE_CAPSULE_MANIFEST_VERSION,
	WORKSPACE_CAPSULE_MAX_ARCHIVE_BYTES,
	WORKSPACE_CAPSULE_MAX_UNPACKED_BYTES,
	type WorkspaceCapsuleEntry,
	type WorkspaceCapsuleGitMetadata,
	type WorkspaceCapsuleManifest,
	WorkspaceCapsuleManifestSchema,
	type WorkspaceCapsuleTeamContext,
} from "@cline/shared";

const MIB = 1024 * 1024;

export const DEFAULT_WORKSPACE_CAPSULE_LIMITS = {
	maxFileBytes: 64 * MIB,
	maxArtifactBytes: WORKSPACE_CAPSULE_MAX_ARCHIVE_BYTES,
	maxTotalBytes: WORKSPACE_CAPSULE_MAX_UNPACKED_BYTES,
	maxArchiveBytes: WORKSPACE_CAPSULE_MAX_ARCHIVE_BYTES,
	maxEntries: 50_000,
} as const;

export interface WorkspaceCapsuleLimits {
	maxFileBytes: number;
	maxArtifactBytes: number;
	maxTotalBytes: number;
	maxArchiveBytes: number;
	maxEntries: number;
}

export interface WorkspaceCapsuleApprovedRoot {
	/** Stable identifier written to the portable manifest. */
	id: string;
	/** Local absolute or relative directory. This path is never serialized. */
	path: string;
}

export interface WorkspaceCapsuleSelection {
	rootId: string;
	/** Parent-selected path relative to the approved root. */
	path: string;
	/** Explicit build products and other non-source inputs use artifact. */
	purpose?: "workspace" | "artifact";
	/** Optional portable destination path inside the hydrated capsule. */
	destination?: string;
}

export interface BuildWorkspaceCapsulePlanOptions {
	roots: WorkspaceCapsuleApprovedRoot[];
	selections: WorkspaceCapsuleSelection[];
	limits?: Partial<WorkspaceCapsuleLimits>;
	git?: WorkspaceCapsuleGitMetadata;
	team?: WorkspaceCapsuleTeamContext;
	now?: () => Date;
}

export interface WorkspaceCapsulePayloadPlanEntry {
	entryPath: string;
	sourceRootId: string;
	sourcePath: string;
	size: number;
	sha256: string;
}

export interface WorkspaceCapsulePlan {
	manifest: WorkspaceCapsuleManifest;
	payloads: WorkspaceCapsulePayloadPlanEntry[];
	/** Sensitive descendants omitted while recursively walking a selection. */
	skippedPaths: WorkspaceCapsuleSkippedPath[];
	/** Resolved planning limits; archive writers enforce maxArchiveBytes. */
	limits: WorkspaceCapsuleLimits;
}

export interface WorkspaceCapsuleSkippedPath {
	rootId: string;
	path: string;
	reason: "blocked_path" | "blocked_secret";
}

export type WorkspaceCapsulePlanningErrorCode =
	| "INVALID_LIMIT"
	| "INVALID_ROOT"
	| "INVALID_SELECTION"
	| "PATH_NOT_FOUND"
	| "PATH_OUTSIDE_APPROVED_ROOT"
	| "BLOCKED_PATH"
	| "BLOCKED_SECRET"
	| "SYMLINK_UNSUPPORTED"
	| "SPECIAL_FILE"
	| "FILE_TOO_LARGE"
	| "TOTAL_TOO_LARGE"
	| "TOO_MANY_ENTRIES"
	| "DESTINATION_COLLISION"
	| "MANIFEST_TOO_LARGE"
	| "ARCHIVE_PATH_TOO_LONG"
	| "ARCHIVE_TOO_LARGE"
	| "PAYLOAD_MISSING"
	| "FILE_CHANGED";

export class WorkspaceCapsulePlanningError extends Error {
	readonly code: WorkspaceCapsulePlanningErrorCode;
	readonly path?: string;

	constructor(
		code: WorkspaceCapsulePlanningErrorCode,
		message: string,
		path?: string,
	) {
		super(message);
		this.name = "WorkspaceCapsulePlanningError";
		this.code = code;
		this.path = path;
	}
}

interface ResolvedRoot {
	id: string;
	path: string;
}

const BLOCKED_DIRECTORY_NAMES = new Set([
	".aws",
	".azure",
	".cline",
	".git",
	".gnupg",
	".kube",
	".ssh",
]);

const BLOCKED_EXACT_FILE_NAMES = new Set([
	".dockercfg",
	".netrc",
	".npmrc",
	".pypirc",
	"id_dsa",
	"id_ecdsa",
	"id_ed25519",
	"id_rsa",
	"service-account.json",
	"service_account.json",
]);

const BLOCKED_SECRET_FILE_PATTERNS = [
	/^\.env(?:\..+)?$/i,
	/^credentials?(?:\..+)?$/i,
	/^secrets?(?:\.(?:json|ya?ml|toml|ini|txt))$/i,
	/\.(?:key|pem|p12|pfx|kdbx)$/i,
];

const SECRET_SCAN_PREFIX_PATTERNS: ReadonlyArray<{
	name: string;
	pattern: RegExp;
}> = [
	{
		name: "private key",
		pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/,
	},
	{
		name: "OpenAI-style key",
		pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/,
	},
	{
		name: "GitHub token",
		pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
	},
	{ name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
	{ name: "Google API key", pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
	{ name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
];

const SECRET_ASSIGNMENT_PATTERN =
	/\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|CLINE_API_KEY|GITHUB_TOKEN|GH_TOKEN|AWS_SECRET_ACCESS_KEY|API_KEY|ACCESS_TOKEN|SECRET_KEY)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{16,})/i;
const OBVIOUS_NON_SECRET_VALUE =
	/(?:example|placeholder|redacted|changeme|dummy|sample|fake|test|process\.env)/i;

class HighConfidenceSecretScanner {
	private text = true;
	private firstChunk = true;
	private tail = "";

	push(chunk: Buffer): string | undefined {
		if (this.firstChunk) {
			this.firstChunk = false;
			const sample = chunk.subarray(0, Math.min(chunk.byteLength, 8192));
			let controls = 0;
			for (const byte of sample) {
				if (byte === 0) {
					this.text = false;
					break;
				}
				if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
					controls++;
				}
			}
			if (sample.byteLength > 0 && controls / sample.byteLength > 0.1) {
				this.text = false;
			}
		}
		if (!this.text) return undefined;

		const text = this.tail + chunk.toString("utf8");
		for (const detector of SECRET_SCAN_PREFIX_PATTERNS) {
			if (detector.pattern.test(text)) return detector.name;
		}
		const assignment = SECRET_ASSIGNMENT_PATTERN.exec(text);
		if (assignment?.[1] && !OBVIOUS_NON_SECRET_VALUE.test(assignment[1])) {
			return "credential assignment";
		}
		this.tail = text.slice(-1024);
		return undefined;
	}
}

function fail(
	code: WorkspaceCapsulePlanningErrorCode,
	message: string,
	path?: string,
): never {
	throw new WorkspaceCapsulePlanningError(code, message, path);
}

function isInside(root: string, candidate: string): boolean {
	const pathFromRoot = relative(root, candidate);
	return (
		pathFromRoot === "" ||
		(!pathFromRoot.startsWith(`..${sep}`) &&
			pathFromRoot !== ".." &&
			!isAbsolute(pathFromRoot))
	);
}

function normalizedRelativeSelection(value: string): string {
	if (!value.trim() || isAbsolute(value)) {
		fail(
			"INVALID_SELECTION",
			"Capsule selections must be non-empty paths relative to an approved root",
			value,
		);
	}
	const normalized = posix.normalize(value.split(sep).join("/"));
	if (
		normalized.startsWith("/") ||
		normalized === ".." ||
		normalized.startsWith("../")
	) {
		fail(
			"PATH_OUTSIDE_APPROVED_ROOT",
			"Capsule selection escapes its approved root",
			value,
		);
	}
	return normalized;
}

function normalizedDestination(value: string): string {
	const normalized = normalizedRelativeSelection(value);
	if (normalized === ".") {
		fail(
			"INVALID_SELECTION",
			"A capsule destination must name a path, not the capsule root",
			value,
		);
	}
	if (
		normalized === WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH ||
		normalized.split("/").some((component) => {
			const lower = component.toLowerCase();
			return (
				lower === ".git" ||
				lower === ".ssh" ||
				lower === ".env" ||
				(lower.startsWith(".env.") && lower !== ".env.example")
			);
		})
	) {
		fail(
			"BLOCKED_PATH",
			"Capsule destination uses a reserved or protected path",
			value,
		);
	}
	return normalized;
}

function validateLimits(
	overrides: Partial<WorkspaceCapsuleLimits> | undefined,
): WorkspaceCapsuleLimits {
	const limits = { ...DEFAULT_WORKSPACE_CAPSULE_LIMITS, ...overrides };
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			fail("INVALID_LIMIT", `${name} must be a positive safe integer`);
		}
	}
	return limits;
}

function assertPathIsAllowed(sourceRelativePath: string): void {
	const segments = sourceRelativePath.split("/").filter(Boolean);
	for (const segment of segments.slice(0, -1)) {
		if (BLOCKED_DIRECTORY_NAMES.has(segment.toLowerCase())) {
			fail(
				"BLOCKED_PATH",
				`Blocked sensitive directory: ${segment}`,
				sourceRelativePath,
			);
		}
	}
	const basename = segments.at(-1)?.toLowerCase();
	if (!basename) return;
	// Checked-in examples are useful source context and intentionally contain
	// placeholders. Their contents still pass through the secret scanner.
	const isEnvironmentExample = basename === ".env.example";
	if (
		BLOCKED_DIRECTORY_NAMES.has(basename) ||
		BLOCKED_EXACT_FILE_NAMES.has(basename) ||
		(!isEnvironmentExample &&
			BLOCKED_SECRET_FILE_PATTERNS.some((pattern) => pattern.test(basename)))
	) {
		fail(
			"BLOCKED_PATH",
			`Blocked secret-like capsule input: ${sourceRelativePath}`,
			sourceRelativePath,
		);
	}
}

async function hashOpenFile(
	path: string,
	expected: { dev: number; ino: number; size: number },
	scanSecrets: boolean,
): Promise<string> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (
			!before.isFile() ||
			before.dev !== expected.dev ||
			before.ino !== expected.ino ||
			before.size !== expected.size
		) {
			fail(
				"FILE_CHANGED",
				"Capsule input changed while it was being planned",
				path,
			);
		}
		const hash = createHash("sha256");
		const scanner = scanSecrets ? new HighConfidenceSecretScanner() : undefined;
		for await (const chunk of handle.createReadStream({ autoClose: false })) {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			hash.update(bytes);
			const finding = scanner?.push(bytes);
			if (finding) {
				fail(
					"BLOCKED_SECRET",
					`Blocked high-confidence ${finding} in workspace capsule input`,
					path,
				);
			}
		}
		const after = await handle.stat();
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs
		) {
			fail(
				"FILE_CHANGED",
				"Capsule input changed while it was being hashed",
				path,
			);
		}
		return hash.digest("hex");
	} finally {
		await handle.close();
	}
}

function childManifestPath(parent: string, child: string): string {
	return parent ? `${parent}/${child}` : child;
}

/**
 * Build a portable capsule manifest and an immutable-by-hash payload plan.
 *
 * This function performs no upload and never discovers files outside the
 * parent-selected paths. Uploaders must hash each payload again and compare it
 * with `sha256`, because a local file can change after planning completes.
 */
export async function buildWorkspaceCapsulePlan(
	options: BuildWorkspaceCapsulePlanOptions,
): Promise<WorkspaceCapsulePlan> {
	const limits = validateLimits(options.limits);
	if (options.roots.length === 0) {
		fail("INVALID_ROOT", "At least one approved capsule root is required");
	}
	if (options.selections.length === 0) {
		fail("INVALID_SELECTION", "At least one capsule selection is required");
	}

	const roots = new Map<string, ResolvedRoot>();
	for (const root of options.roots) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(root.id)) {
			fail("INVALID_ROOT", `Invalid capsule root id: ${root.id}`);
		}
		if (roots.has(root.id)) {
			fail("INVALID_ROOT", `Duplicate capsule root id: ${root.id}`);
		}
		let canonicalPath: string;
		try {
			canonicalPath = await realpath(resolve(root.path));
			const rootStat = await lstat(canonicalPath);
			if (!rootStat.isDirectory()) {
				fail(
					"INVALID_ROOT",
					"Approved capsule roots must be directories",
					root.path,
				);
			}
		} catch (error) {
			if (error instanceof WorkspaceCapsulePlanningError) throw error;
			fail("INVALID_ROOT", "Approved capsule root does not exist", root.path);
		}
		roots.set(root.id, { id: root.id, path: canonicalPath });
	}

	const entries = new Map<
		string,
		WorkspaceCapsuleEntry & { sourcePath: string }
	>();
	const payloads: WorkspaceCapsulePayloadPlanEntry[] = [];
	const skippedPaths: WorkspaceCapsuleSkippedPath[] = [];
	let totalBytes = 0;

	const reserveEntry = (
		entry: WorkspaceCapsuleEntry,
		sourcePath: string,
	): boolean => {
		const existing = entries.get(entry.path);
		if (existing) {
			if (
				existing.sourcePath === sourcePath &&
				existing.kind === entry.kind &&
				existing.purpose === entry.purpose
			) {
				return false;
			}
			fail(
				"DESTINATION_COLLISION",
				`Multiple capsule inputs map to ${entry.path}`,
				entry.path,
			);
		}
		if (entries.size + 1 > limits.maxEntries) {
			fail(
				"TOO_MANY_ENTRIES",
				`Capsule exceeds the ${limits.maxEntries} entry limit`,
				entry.path,
			);
		}
		if (totalBytes + entry.size > limits.maxTotalBytes) {
			fail(
				"TOTAL_TOO_LARGE",
				`Capsule exceeds the ${limits.maxTotalBytes} byte aggregate limit`,
				entry.path,
			);
		}
		entries.set(entry.path, { ...entry, sourcePath });
		totalBytes += entry.size;
		return true;
	};

	const visit = async (input: {
		root: ResolvedRoot;
		absolutePath: string;
		sourceRelativePath: string;
		manifestPath: string;
		purpose: "workspace" | "artifact";
		directSelection: boolean;
	}): Promise<void> => {
		try {
			assertPathIsAllowed(input.sourceRelativePath);
		} catch (error) {
			if (
				!input.directSelection &&
				error instanceof WorkspaceCapsulePlanningError &&
				error.code === "BLOCKED_PATH"
			) {
				skippedPaths.push({
					rootId: input.root.id,
					path: input.sourceRelativePath,
					reason: "blocked_path",
				});
				return;
			}
			throw error;
		}

		let stat: Stats;
		try {
			stat = await lstat(input.absolutePath);
		} catch {
			fail(
				"PATH_NOT_FOUND",
				"Selected capsule input does not exist",
				input.sourceRelativePath,
			);
		}

		const mode = stat.mode & 0o777;
		if (stat.isSymbolicLink()) {
			fail(
				"SYMLINK_UNSUPPORTED",
				"Workspace capsule v1 does not transfer symlinks",
				input.sourceRelativePath,
			);
		}

		if (stat.isDirectory()) {
			if (input.manifestPath) {
				reserveEntry(
					{
						kind: "directory",
						path: input.manifestPath,
						sourceRootId: input.root.id,
						purpose: input.purpose,
						mode,
						size: 0,
					},
					input.absolutePath,
				);
			}
			const children = await readdir(input.absolutePath, {
				withFileTypes: true,
			});
			children.sort((left, right) => left.name.localeCompare(right.name));
			for (const child of children) {
				await visit({
					...input,
					directSelection: false,
					absolutePath: resolve(input.absolutePath, child.name),
					sourceRelativePath: childManifestPath(
						input.sourceRelativePath === "." ? "" : input.sourceRelativePath,
						child.name,
					),
					manifestPath: childManifestPath(input.manifestPath, child.name),
				});
			}
			return;
		}

		if (!stat.isFile()) {
			fail(
				"SPECIAL_FILE",
				"Sockets, devices, FIFOs, and other special files cannot be added to a capsule",
				input.sourceRelativePath,
			);
		}

		const fileLimit =
			input.purpose === "artifact"
				? limits.maxArtifactBytes
				: limits.maxFileBytes;
		if (stat.size > fileLimit) {
			fail(
				"FILE_TOO_LARGE",
				`Capsule input exceeds its ${fileLimit} byte file limit`,
				input.sourceRelativePath,
			);
		}
		let sha256: string;
		try {
			sha256 = await hashOpenFile(input.absolutePath, stat, true);
		} catch (error) {
			if (
				!input.directSelection &&
				error instanceof WorkspaceCapsulePlanningError &&
				error.code === "BLOCKED_SECRET"
			) {
				skippedPaths.push({
					rootId: input.root.id,
					path: input.sourceRelativePath,
					reason: "blocked_secret",
				});
				return;
			}
			throw error;
		}
		const entry: WorkspaceCapsuleEntry = {
			kind: "file",
			path: input.manifestPath,
			sourceRootId: input.root.id,
			purpose: input.purpose,
			mode,
			size: stat.size,
			sha256,
		};
		if (reserveEntry(entry, input.absolutePath)) {
			payloads.push({
				entryPath: input.manifestPath,
				sourceRootId: input.root.id,
				sourcePath: input.absolutePath,
				size: stat.size,
				sha256,
			});
		}
	};

	for (const selection of options.selections) {
		const root = roots.get(selection.rootId);
		if (!root) {
			fail("INVALID_SELECTION", `Unknown approved root: ${selection.rootId}`);
		}
		const sourceRelativePath = normalizedRelativeSelection(selection.path);
		const candidate = resolve(root.path, sourceRelativePath);
		if (!isInside(root.path, candidate)) {
			fail(
				"PATH_OUTSIDE_APPROVED_ROOT",
				"Capsule selection escapes its approved root",
				selection.path,
			);
		}
		let canonicalCandidate: string;
		try {
			canonicalCandidate = await realpath(candidate);
		} catch {
			fail(
				"PATH_NOT_FOUND",
				"Selected capsule input does not exist",
				selection.path,
			);
		}
		if (!isInside(root.path, canonicalCandidate)) {
			fail(
				"PATH_OUTSIDE_APPROVED_ROOT",
				"Capsule selection resolves outside its approved root",
				selection.path,
			);
		}

		const manifestPath = selection.destination
			? normalizedDestination(selection.destination)
			: sourceRelativePath === "."
				? ""
				: normalizedDestination(sourceRelativePath);
		await visit({
			root,
			absolutePath: candidate,
			sourceRelativePath,
			manifestPath,
			purpose: selection.purpose ?? "workspace",
			directSelection: true,
		});
	}

	const manifestEntries = Array.from(entries.values())
		.map(({ sourcePath: _sourcePath, ...entry }) => entry)
		.sort((left, right) => left.path.localeCompare(right.path));
	payloads.sort((left, right) => left.entryPath.localeCompare(right.entryPath));

	const manifest = WorkspaceCapsuleManifestSchema.parse({
		version: WORKSPACE_CAPSULE_MANIFEST_VERSION,
		createdAt: (options.now ?? (() => new Date()))().toISOString(),
		roots: Array.from(roots.values())
			.map(({ id }) => ({ id }))
			.sort((left, right) => left.id.localeCompare(right.id)),
		entries: manifestEntries,
		totalBytes,
		git: options.git,
		team: options.team,
	});

	skippedPaths.sort((left, right) =>
		left.rootId === right.rootId
			? left.path.localeCompare(right.path)
			: left.rootId.localeCompare(right.rootId),
	);
	return { manifest, payloads, skippedPaths, limits };
}
