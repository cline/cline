import type { ToolProfile } from "@cline/shared/gateway";

export const DEFAULT_TOOL_PROFILES: readonly ToolProfile[] = [
	{
		name: "coding",
		revision: 1,
		required: ["builtin:submit_and_exit", "builtin:read_files"],
		optional: [
			"builtin:search_codebase",
			"builtin:run_commands",
			"builtin:editor",
			"builtin:fetch_web_content",
			"builtin:ask_question",
		],
	},
	{
		name: "lead",
		revision: 1,
		extends: ["coding"],
		required: [],
		optional: [],
	},
	{
		name: "worker",
		revision: 1,
		extends: ["coding"],
		required: [],
		optional: [],
	},
	{
		name: "contractor",
		revision: 1,
		extends: ["coding"],
		required: [],
		optional: [],
	},
];

export function expandProfiles(
	names: readonly string[],
	profiles: readonly ToolProfile[],
): {
	required: Set<string>;
	optional: Set<string>;
	revisions: Record<string, number>;
} {
	const byName = new Map(profiles.map((profile) => [profile.name, profile]));
	const required = new Set<string>();
	const optional = new Set<string>();
	const revisions: Record<string, number> = {};
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (name: string): void => {
		if (visited.has(name)) return;
		if (visiting.has(name)) throw new Error(`Tool profile cycle at ${name}`);
		const profile = byName.get(name);
		if (!profile) throw new Error(`Unknown tool profile: ${name}`);
		visiting.add(name);
		for (const parent of profile.extends ?? []) visit(parent);
		for (const id of profile.required) {
			required.add(id);
			optional.delete(id);
		}
		for (const id of profile.optional) if (!required.has(id)) optional.add(id);
		revisions[name] = profile.revision;
		visiting.delete(name);
		visited.add(name);
	};
	for (const name of names) visit(name);
	return { required, optional, revisions };
}
