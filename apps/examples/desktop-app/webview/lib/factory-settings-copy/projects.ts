/**
 * Factory settings words: Projects (the list and one project's detail).
 */

import type { FactoryGuidanceRole } from "@/lib/factory-settings-client";
import { plural } from "./shell";

/** A guidance target's name, as on the Guidance page. */
export const FS_GUIDANCE_ROLE: Record<FactoryGuidanceRole, string> = {
	manager: "Manager readme",
	factory: "Routing",
	designer: "Scoping agent",
	plan_reviewer: "Plan checker",
	builder: "Builder",
	verifier: "Tester",
	reviewer: "Code reviewer",
};

const needs = (count: number) => (count === 1 ? "needs" : "need");

export const FS_PROJECTS = {
	scope:
		"Repositories Factory has worked in. A project appears here when you give Factory work in it.",
	search:
		"Repositories Factory has worked in: their stages, test setup, guidance, task files, and forgetting a project's approvals.",
	count: (count: number) => plural(count, "project"),
	empty:
		"No projects yet. A project appears once it has a card or has been opened in Cline.",
	emptyAction: "Ask Factory",
	summaryUnavailable:
		"Project status needs a newer Cline. Update Cline to see it.",
	prTarget: (branch: string) => `PRs target ${branch}`,
	openCards: (count: number) => plural(count, "open card"),
	stages: (count: number) =>
		count === 0 ? "no stages" : plural(count, "stage"),
	testSetup: {
		none: "no test setup",
		proposed: "test setup proposed",
		in_use: "test setup in use",
		changed: "test setup changed",
		invalid: "test setup can't be read",
	},
	guidanceFor: (roles: string) => `guidance for ${roles}`,
	noGuidance: "no guidance",
	pill: {
		stagesInvalid: "Can't read stages.json",
		stagesAwaiting: (count: number) =>
			`${plural(count, "stage")} ${needs(count)} approval`,
		testSetupProposed: "Test setup needs approval",
		testSetupChanged: "Test setup changed",
		testSetupInvalid: "Can't read test setup",
		guidanceChanged: "Guidance changed outside Factory",
		ready: "Ready",
		nothing: "Nothing set up",
	},

	// Detail
	back: "Back to Projects",
	setUpGroup: "Set up for this project",
	resetGroup: "Reset",
	copyPath: "Copy path",
	repositoryStages: "Repository stages",
	stagesNone:
		"None. Stages are extra steps, such as a security scan, that run after Build.",
	stagesSummary: (total: number, inUse: number, awaiting: number) =>
		`${plural(total, "stage")}: ${inUse} in use${
			awaiting ? `, ${awaiting} ${needs(awaiting)} approval` : ""
		}.`,
	stagesInvalid: "stages.json can't be read. Open Stages to see why.",
	stagesPill: {
		inUse: "In use",
		none: "None",
		awaiting: (count: number) => `${count} ${needs(count)} approval`,
	},
	testSetup_: "Test setup",
	testSetupHint: {
		none: "Not set up. The tester checks only what the plan's commands cover.",
		proposed: "Proposed by Factory, not approved yet.",
		in_use: "In use.",
		changed:
			"The file changed since you approved it. Nothing runs until you decide.",
		invalid: "The test setup file can't be read.",
	},
	testSetupPill: {
		none: "Not set up",
		proposed: "Needs approval",
		in_use: "In use",
		changed: "Changed since approved",
		invalid: "Can't read",
	},
	repositoryGuidance: "Repository guidance",
	guidanceHint: (roles: string, changed: string | undefined) =>
		`${roles}.${changed ? ` ${changed} was changed outside Factory.` : ""}`,
	guidanceNone: "None",
	guidanceChangedPill: (count: number) => `${count} changed`,
	taskFiles: "Task files",
	taskFilesHint: (count: number) =>
		count === 0
			? "None. Files in .cline/tasks become cards."
			: `${plural(count, "file")} in .cline/tasks become cards when they change.`,
	taskFilesUnknown: "Files in .cline/tasks become cards when they change.",
	forget: (name: string) => `Forget approvals for ${name}`,
	forgetHint:
		"Stages and the test setup stop running here until you approve them again. Files in the repository are not changed.",
	forgetAction: "Forget approvals…",
	forgetVerb: "Forget approvals",
	/** The confirmation's count, from the dry run. */
	forgetCount: (stages: number, testSetup: boolean) =>
		`${[
			stages ? `${plural(stages, "stage approval")}` : "",
			testSetup ? "the test setup approval" : "",
		]
			.filter(Boolean)
			.join(" and ")} will be forgotten.`,
	forgetNothing: (name: string) =>
		`Nothing in ${name} is approved, so there is nothing to forget.`,
	forgotten: (stages: number, testSetup: boolean) =>
		`Forgot ${[
			stages ? plural(stages, "stage approval") : "",
			testSetup ? "the test setup approval" : "",
		]
			.filter(Boolean)
			.join(" and ")}.`,
} as const;
