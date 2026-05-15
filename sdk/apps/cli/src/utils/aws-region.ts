import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function parseAwsConfigProfiles(
	content: string,
): Record<string, Record<string, string>> {
	const profiles: Record<string, Record<string, string>> = {};
	let currentProfile: string | undefined;

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith(";")) continue;

		const sectionMatch = line.match(/^\[([^\]]+)]$/);
		if (sectionMatch) {
			const section = sectionMatch[1]?.trim() ?? "";
			currentProfile = section.startsWith("profile ")
				? section.slice("profile ".length).trim()
				: section;
			profiles[currentProfile] ??= {};
			continue;
		}

		if (!currentProfile) continue;
		const separatorIndex = line.indexOf("=");
		if (separatorIndex === -1) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		profiles[currentProfile][key] = value;
	}

	return profiles;
}

function readAwsConfigRegion(profile: string): string | undefined {
	const configPath =
		process.env.AWS_CONFIG_FILE?.trim() || join(homedir(), ".aws", "config");
	if (!existsSync(configPath)) return undefined;

	try {
		const profiles = parseAwsConfigProfiles(readFileSync(configPath, "utf8"));
		return profiles[profile]?.region?.trim() || undefined;
	} catch {
		return undefined;
	}
}

export function resolveAwsRegion(
	input: { explicitRegion?: string; profile?: string } = {},
): string | undefined {
	const explicitRegion = input.explicitRegion?.trim();
	if (explicitRegion) return explicitRegion;

	const envRegion =
		process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
	if (envRegion) return envRegion;

	const profile =
		input.profile?.trim() || process.env.AWS_PROFILE?.trim() || "default";
	return (
		readAwsConfigRegion(profile) ??
		(profile !== "default" ? readAwsConfigRegion("default") : undefined)
	);
}
