/**
 * Load + parse a Driveagent home from disk (FS boundary for DRV-DRIVEAGENT-HOME).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type DriveagentHome,
	DriveagentSlugSchema,
	parseDriveagentAgentYaml,
	parseDriveagentEnvYaml,
	parseDriveagentHome,
	parseDriveagentPermissionsYaml,
} from "@cline/shared";
import YAML from "yaml";
import {
	DRIVEAGENT_AGENT_YAML,
	DRIVEAGENT_ENV_YAML,
	DRIVEAGENT_PERMISSIONS_YAML,
	type DriveagentHomeTier,
	resolveDriveagentHomeDir,
} from "./resolve";

export type DriveagentHomeLoadErrorCode = "unknown_agent" | "invalid_home";

export class DriveagentHomeLoadError extends Error {
	readonly code: DriveagentHomeLoadErrorCode;

	constructor(code: DriveagentHomeLoadErrorCode, message: string) {
		super(message);
		this.name = "DriveagentHomeLoadError";
		this.code = code;
	}
}

export type LoadedDriveagentHome = {
	readonly home: DriveagentHome;
	readonly homePath: string;
	readonly tier: DriveagentHomeTier;
};

function readYamlFile(homePath: string, fileName: string): unknown {
	const filePath = join(homePath, fileName);
	let text: string;
	try {
		text = readFileSync(filePath, "utf8");
	} catch {
		throw new DriveagentHomeLoadError(
			"invalid_home",
			`Driveagent home is missing ${fileName}`,
		);
	}
	try {
		return YAML.parse(text) as unknown;
	} catch (error) {
		throw new DriveagentHomeLoadError(
			"invalid_home",
			`Failed to parse ${fileName}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Resolve, read, and schema-parse a Driveagent home for `slug`.
 * Throws {@link DriveagentHomeLoadError} with `unknown_agent` or `invalid_home`.
 */
export function loadDriveagentHome(input: {
	workspaceRoot: string;
	slug: string;
	userHomeDir?: string;
}): LoadedDriveagentHome {
	const slugResult = DriveagentSlugSchema.safeParse(input.slug);
	if (!slugResult.success) {
		throw new DriveagentHomeLoadError(
			"unknown_agent",
			`Unknown or invalid Driveagent slug: ${input.slug}`,
		);
	}
	const slug = slugResult.data;

	const resolved = resolveDriveagentHomeDir({
		workspaceRoot: input.workspaceRoot,
		slug,
		userHomeDir: input.userHomeDir,
	});
	if (!resolved) {
		throw new DriveagentHomeLoadError(
			"unknown_agent",
			`Unknown Driveagent: ${slug}`,
		);
	}

	try {
		const agent = parseDriveagentAgentYaml(
			readYamlFile(resolved.path, DRIVEAGENT_AGENT_YAML),
		);
		const permissions = parseDriveagentPermissionsYaml(
			readYamlFile(resolved.path, DRIVEAGENT_PERMISSIONS_YAML),
		);
		const env = parseDriveagentEnvYaml(
			readYamlFile(resolved.path, DRIVEAGENT_ENV_YAML),
		);
		const home = parseDriveagentHome({ slug, agent, permissions, env });
		return {
			home,
			homePath: resolved.path,
			tier: resolved.tier,
		};
	} catch (error) {
		if (error instanceof DriveagentHomeLoadError) {
			throw error;
		}
		throw new DriveagentHomeLoadError(
			"invalid_home",
			error instanceof Error ? error.message : String(error),
		);
	}
}
