/**
 * Factory settings words: Stages (spec 3.5). Status names and the
 * "Once approved…" line keep their wording from `FACTORY_STAGES`.
 */

import type { FactoryReviewSize } from "@cline/shared/browser";
import { FACTORY_STAGES } from "@/lib/factory-copy";
import { plural } from "./shell";

const SIZE: Record<FactoryReviewSize, string> = {
	trivial: "any",
	local: "a local",
	shared_contract: "a large",
	cross_cutting: "a cross-cutting",
};

export const FS_STAGES = {
	scope:
		"Every card goes through the same five stages. A project can add its own stages after Build; each one runs only after you approve its exact definition.",
	/** The stage line: a figure, with this text alternative. */
	lineLabel:
		"The five stages of a card: 1 Scope, 2 Build, then the repository stages, 3 Verify, 4 Review, 5 Done.",
	line: [
		{
			id: "scope",
			name: "Scope",
			detail: "Scoping agent plans, plan checkers check",
		},
		{ id: "build", name: "Build", detail: "Builders write the code" },
		{
			id: "repository",
			name: "Repository stages",
			detail: "run here, after Build",
		},
		{ id: "verify", name: "Verify", detail: "Plan checks, then the tester" },
		{ id: "review", name: "Review", detail: "Code reviewers, fix rounds" },
		{ id: "done", name: "Done", detail: "Draft PR" },
	],
	group: "Repository stages",
	groupHint: (project: string) => `${project} · .cline/factory/stages.json`,
	addStage: "Add stage",
	/** Drafts put in Ask Factory's composer, unsent. */
	addDraft: (project: string) => `Add a stage to ${project} that `,
	changeDraft: (name: string, project: string) =>
		`Change the “${name}” stage in ${project} so that `,
	removeDraft: (name: string, project: string) =>
		`Remove the “${name}” stage from ${project}.`,
	fixDraft: (project: string, reason: string) =>
		`Fix .cline/factory/stages.json in ${project}. It can't be read: ${reason}`,
	change: "Change with Ask Factory",
	remove: "Remove with Ask Factory",
	fix: "Fix with Ask Factory",
	moreActions: (name: string) => `More actions for ${name}`,
	/** The summary line under a stage's name. */
	kind: {
		command: "Command",
		read: "Agent, read-only",
		write: "Agent, can change code before review",
	},
	when: (paths?: readonly string[], minSize?: FactoryReviewSize) => {
		const where = paths?.length
			? `when ${paths.join(" or ")} ${paths.length === 1 ? "changes" : "change"}`
			: undefined;
		const size =
			minSize && minSize !== "trivial"
				? `in ${SIZE[minSize]} change`
				: undefined;
		if (where && size) return `${where} ${size}`;
		if (where) return where;
		if (size) return `on every card ${size}`;
		return "always";
	},
	blocks: "blocks delivery",
	notBlocking: FACTORY_STAGES.notBlocking,
	trust: { ...FACTORY_STAGES.trust },
	approve: FACTORY_STAGES.approve,
	stopUsing: FACTORY_STAGES.stopUsing,
	approveRunsAsYou: FACTORY_STAGES.approveRunsAsYou,
	runsAsYou:
		"Factory runs this in each card's worktree on this computer, as you, with access to your files.",
	/** Under an agent stage's definition. */
	agentModel: (role: string, model: string) =>
		model ? `Runs on ${role}'s model (${model}).` : `Runs on ${role}'s model.`,
	agentRole: { read: "Code reviewer 1", write: "Builder 1" },
	coversDefinition:
		"Approval covers this exact definition; if the file changes, Factory asks again.",
	empty: (project: string) =>
		`No stages in ${project}. Stages are extra steps, such as a security scan, that run after Build.`,
	ideasTitle: "Ideas to start from",
	ideas: [
		{
			text: "Run the security scanner when files under src/auth change",
			draft: (project: string) =>
				`Add a stage to ${project} that runs the security scanner when files under src/auth change`,
		},
		{
			text: "An agent that checks every migration has a rollback note",
			draft: (project: string) =>
				`Add a stage to ${project} where an agent checks every migration has a rollback note`,
		},
	],
	invalidPill: "Can't read stages.json",
	invalidTitle: "Factory can't read this project's stages.json.",
	invalidBody: "No repository stage runs here until the file is fixed.",
	readFailed: "Couldn't read this project's repository stages.",
	unavailable: "Repository stages: update Cline to use them.",
	otherProjects: "Other projects",
	otherSummary: (stages: {
		file: "absent" | "present" | "invalid";
		total: number;
		inUse: number;
		awaiting: number;
	}) =>
		stages.file === "invalid"
			? "Can't read stages.json"
			: !stages.total
				? "No repository stages"
				: stages.awaiting
					? `${stages.awaiting} ${stages.awaiting === 1 ? "needs" : "need"} a decision`
					: `${plural(stages.inUse, "stage")} in use`,
	noProject:
		"No projects yet. A project appears here when you give Factory work in it.",
	search: {
		stages: {
			title: "Repository stages",
			description:
				"Extra steps a project runs after Build, once you approve them",
		},
	},
} as const;
