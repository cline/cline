/**
 * Session skill allowlist semantics, shared by every surface a skill can
 * reach: the skills tool executor, runtime command registration, and slash
 * command resolution. `undefined` means "no allowlist" (all skills allowed);
 * an empty array disables all skills.
 */

export function normalizeSkillToken(token: string): string {
	return token.trim().replace(/^\/+/, "").toLowerCase();
}

export function toAllowedSkillSet(
	allowedSkillNames?: ReadonlyArray<string>,
): Set<string> | undefined {
	if (allowedSkillNames === undefined) {
		return undefined;
	}
	const normalized = allowedSkillNames
		.map(normalizeSkillToken)
		.filter((token) => token.length > 0);
	return new Set(normalized);
}

/**
 * A bare allowlist entry (`deploy`) matches both a skill named `deploy` and
 * any namespaced skill ending in `:deploy`, mirroring how skill invocation
 * resolves bare names to namespaced skills. This is scoping, not a trust
 * boundary between skill sources: whoever can define `untrusted:deploy` can
 * define a skill named exactly `deploy` too, since names are not reserved
 * (built-ins excepted). Use a namespaced entry (`plugin:deploy`) to match
 * only that qualified skill.
 */
export function isSkillAllowed(
	skillId: string,
	skillName: string,
	allowedSkills?: Set<string>,
): boolean {
	if (!allowedSkills) {
		return true;
	}
	const normalizedId = normalizeSkillToken(skillId);
	const normalizedName = normalizeSkillToken(skillName);
	const bareId = normalizedId.includes(":")
		? (normalizedId.split(":").at(-1) ?? normalizedId)
		: normalizedId;
	const bareName = normalizedName.includes(":")
		? (normalizedName.split(":").at(-1) ?? normalizedName)
		: normalizedName;
	return (
		allowedSkills.has(normalizedId) ||
		allowedSkills.has(normalizedName) ||
		allowedSkills.has(bareId) ||
		allowedSkills.has(bareName)
	);
}
