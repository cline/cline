import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, relative, resolve } from "node:path";
import {
	CLINE_BOUNDARY_FILE_NAME,
	CLINE_IGNORE_FILE_NAME,
	matchesAnyGlob,
	matchesGlob,
	type ResolvedHierarchicalWorkspace,
	type ResolveWorkspaceOptions,
	WORKSPACE_CONFIG_FILE_NAME,
	type WorkspaceConfig,
	WorkspaceConfigSchema,
	type WorkspaceLayer,
} from "./workspace-schema";

export * from "./workspace-schema";

const CLINE_DIR_NAME = ".cline";
const LEGACY_CLINE_RULES_NAME = ".clinerules";

/**
 * Read ignore patterns from .clineignore in the given directory if present.
 */
export function loadClineIgnorePatternsSync(dir: string): string[] {
	const candidateFiles = [
		join(dir, CLINE_IGNORE_FILE_NAME),
		join(dir, CLINE_DIR_NAME, CLINE_IGNORE_FILE_NAME),
	];

	const patterns: string[] = [];
	for (const candidate of candidateFiles) {
		if (existsSync(candidate)) {
			try {
				const content = readFileSync(candidate, "utf8");
				for (const line of content.split("\n")) {
					const trimmed = line.trim();
					if (trimmed && !trimmed.startsWith("#")) {
						patterns.push(trimmed);
					}
				}
			} catch {
				// Ignore read errors
			}
		}
	}
	return patterns;
}

/**
 * Synchronously load and validate workspace.json configuration for a directory.
 */
export function loadWorkspaceConfigSync(dir: string): WorkspaceConfig {
	const configPath = join(dir, CLINE_DIR_NAME, WORKSPACE_CONFIG_FILE_NAME);
	if (!existsSync(configPath)) {
		return WorkspaceConfigSchema.parse({});
	}

	try {
		const content = readFileSync(configPath, "utf8");
		const raw = JSON.parse(content);
		const parsed = WorkspaceConfigSchema.safeParse(raw);
		if (parsed.success) {
			return parsed.data;
		}
		return WorkspaceConfigSchema.parse({});
	} catch {
		return WorkspaceConfigSchema.parse({});
	}
}

/**
 * Detect capabilities of a workspace layer.
 */
function inspectLayerCapabilities(
	dir: string,
): Omit<WorkspaceLayer, "path" | "config"> {
	const clineDir = join(dir, CLINE_DIR_NAME);
	const clineRulesDir = join(clineDir, "rules");
	const legacyRulesFile = join(dir, LEGACY_CLINE_RULES_NAME);
	const clineRulesFile = join(clineDir, "rules.md");
	const hasRules =
		existsSync(clineRulesDir) ||
		existsSync(legacyRulesFile) ||
		existsSync(clineRulesFile);

	const clineSkillsDir = join(clineDir, "skills");
	const agentSkillsDir = join(dir, ".agents", "skills");
	const hasSkills = existsSync(clineSkillsDir) || existsSync(agentSkillsDir);

	const clineAgentsDir = join(clineDir, "agents");
	const agentsDir = join(dir, ".agents");
	const hasAgents = existsSync(clineAgentsDir) || existsSync(agentsDir);

	const clineWorkflowsDir = join(clineDir, "workflows");
	const hasWorkflows = existsSync(clineWorkflowsDir);

	const isGitRoot = existsSync(join(dir, ".git"));

	return {
		hasRules,
		hasSkills,
		hasAgents,
		hasWorkflows,
		isGitRoot,
	};
}

/**
 * Check if a directory marks an isolation boundary.
 */
function isIsolationBoundary(dir: string, config: WorkspaceConfig): boolean {
	if (config.isolated) {
		return true;
	}
	const boundaryFile = join(dir, CLINE_BOUNDARY_FILE_NAME);
	const clineBoundaryFile = join(dir, CLINE_DIR_NAME, CLINE_BOUNDARY_FILE_NAME);
	return existsSync(boundaryFile) || existsSync(clineBoundaryFile);
}

/**
 * Discover sub-clines matching `includes` globs under a workspace root.
 */
function discoverSubClinesSync(
	workspacePath: string,
	config: WorkspaceConfig,
	clineIgnores: string[],
): string[] {
	if (!config.includes || config.includes.length === 0) {
		return [];
	}

	const allIgnores = [...config.ignores, ...clineIgnores];
	const discovered = new Set<string>();

	for (const pattern of config.includes) {
		const cleanPattern = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
		const prefixMatch = cleanPattern.split(/[*?]/)[0];
		const prefixDir = prefixMatch ? dirname(prefixMatch) : "";
		const startScanDir =
			prefixDir === "." ? workspacePath : resolve(workspacePath, prefixDir);

		if (!existsSync(startScanDir)) {
			continue;
		}

		const queue: { dir: string; depth: number }[] = [
			{ dir: startScanDir, depth: 0 },
		];

		while (queue.length > 0) {
			const item = queue.shift();
			if (!item) {
				break;
			}
			const { dir: currentDir, depth } = item;

			let entries: import("node:fs").Dirent[] = [];
			try {
				entries = readdirSync(currentDir, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (!entry.isDirectory() && !entry.isSymbolicLink()) {
					continue;
				}

				if (
					entry.name === "node_modules" ||
					entry.name === ".git" ||
					entry.name === ".cline"
				) {
					continue;
				}

				const fullSubPath = join(currentDir, entry.name);
				const relToWorkspace = relative(workspacePath, fullSubPath).replace(
					/\\/g,
					"/",
				);

				if (matchesAnyGlob(allIgnores, relToWorkspace)) {
					continue;
				}

				if (matchesGlob(cleanPattern, relToWorkspace)) {
					const hasSubCline =
						existsSync(join(fullSubPath, CLINE_DIR_NAME)) ||
						existsSync(join(fullSubPath, LEGACY_CLINE_RULES_NAME));
					if (hasSubCline) {
						discovered.add(fullSubPath);
					}
				}

				if (depth < 4) {
					queue.push({ dir: fullSubPath, depth: depth + 1 });
				}
			}
		}
	}

	return Array.from(discovered);
}

/**
 * Synchronously traverse upward from startPath to find all workspace layers
 * respecting boundary stops (Git root, user home, isolation boundaries).
 */
export function findWorkspaceHierarchySync(
	startPath: string,
	options: ResolveWorkspaceOptions = {},
): {
	targetPath: string;
	discoveredRoots: string[];
	layers: WorkspaceLayer[];
	isInitialized: boolean;
	primaryRoot: string;
	discoveredSubClines: string[];
} {
	const resolvedStart = resolve(startPath);
	let currentDir = resolvedStart;
	try {
		if (existsSync(resolvedStart) && statSync(resolvedStart).isFile()) {
			currentDir = dirname(resolvedStart);
		}
	} catch {
		currentDir = resolvedStart;
	}

	const targetPath = currentDir;
	const userHome = options.userHomeDir
		? resolve(options.userHomeDir)
		: homedir();
	const stopAtGit = options.stopAtGitRoot !== false;

	const visited = new Set<string>();
	const discoveredRoots: string[] = [];
	const layerConfigs = new Map<string, WorkspaceConfig>();

	let nearestRoot: string | undefined;

	while (true) {
		const normalizedCurrent = normalize(currentDir);
		if (visited.has(normalizedCurrent)) {
			break;
		}
		visited.add(normalizedCurrent);

		const hasCline =
			existsSync(join(normalizedCurrent, CLINE_DIR_NAME)) ||
			existsSync(join(normalizedCurrent, LEGACY_CLINE_RULES_NAME));

		let isIsolated = false;

		if (hasCline) {
			discoveredRoots.push(normalizedCurrent);
			if (!nearestRoot) {
				nearestRoot = normalizedCurrent;
			}

			const config = loadWorkspaceConfigSync(normalizedCurrent);
			layerConfigs.set(normalizedCurrent, config);
			isIsolated = isIsolationBoundary(normalizedCurrent, config);

			// If the workspace is isolated, halt upward traversal immediately
			if (isIsolated) {
				break;
			}
		}

		// Boundary Check 1: Git Root
		const isGitRoot = existsSync(join(normalizedCurrent, ".git"));
		if (stopAtGit && isGitRoot) {
			break;
		}

		// Boundary Check 2: User Home Directory (do not ascend above home)
		if (normalizedCurrent === userHome) {
			break;
		}

		// Boundary Check 3: Filesystem Root
		const parentDir = dirname(normalizedCurrent);
		if (parentDir === normalizedCurrent) {
			break;
		}

		currentDir = parentDir;
	}

	const isInitialized = nearestRoot !== undefined;
	const primaryRoot = nearestRoot ?? targetPath;

	// Build active layers ordered from root-most ancestor to primaryRoot
	const orderedRoots = [...discoveredRoots].reverse();
	const layers: WorkspaceLayer[] = orderedRoots.map((dir) => {
		const config = layerConfigs.get(dir) ?? loadWorkspaceConfigSync(dir);
		const caps = inspectLayerCapabilities(dir);
		return {
			path: dir,
			config,
			...caps,
		};
	});

	// Discover sub-clines declared by includes
	const subClinesSet = new Set<string>();
	for (const layer of layers) {
		const clineIgnores = loadClineIgnorePatternsSync(layer.path);
		const subClines = discoverSubClinesSync(
			layer.path,
			layer.config,
			clineIgnores,
		);
		for (const sub of subClines) {
			subClinesSet.add(sub);
		}
	}

	return {
		targetPath,
		discoveredRoots,
		layers,
		isInitialized,
		primaryRoot,
		discoveredSubClines: Array.from(subClinesSet),
	};
}

/**
 * Synchronous core entry point for hierarchical workspace resolution.
 */
export function resolveHierarchicalWorkspaceSync(
	startPath: string,
	options: ResolveWorkspaceOptions = {},
): ResolvedHierarchicalWorkspace {
	const hierarchy = findWorkspaceHierarchySync(startPath, options);
	return {
		primaryRoot: hierarchy.primaryRoot,
		targetPath: hierarchy.targetPath,
		layers: hierarchy.layers,
		isInitialized: hierarchy.isInitialized,
		discoveredSubClines: hierarchy.discoveredSubClines,
	};
}

/**
 * Asynchronous core entry point for hierarchical workspace resolution.
 * Conforms to RFC 0001 specification.
 */
export async function resolveHierarchicalWorkspace(
	startPath: string,
	options: ResolveWorkspaceOptions = {},
): Promise<ResolvedHierarchicalWorkspace> {
	return resolveHierarchicalWorkspaceSync(startPath, options);
}

/**
 * Asynchronous helper to find workspace hierarchy.
 */
export async function findWorkspaceHierarchy(
	startPath: string,
	options: ResolveWorkspaceOptions = {},
) {
	return findWorkspaceHierarchySync(startPath, options);
}
