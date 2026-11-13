import type { FactoryProjectSummary } from "@/lib/factory-settings-client";
import {
	FS_GUIDANCE_ROLE,
	FS_PROJECTS,
} from "@/lib/factory-settings-copy/projects";
import { tildePath } from "../../../factory-settings-rows";
import type { FactoryTone } from "../../../factory-ui";

const P = FS_PROJECTS;

/** "github.com/cline/cline" from an origin URL (https, ssh or scp form). */
export function shortRemote(remote: string | undefined): string | undefined {
	if (!remote) return undefined;
	return remote
		.trim()
		.replace(/^[a-z+]+:\/\//i, "")
		.replace(/^[^@/]+@/, "")
		.replace(/^([^/:]+):(?!\d)/, "$1/")
		.replace(/\.git$/, "")
		.replace(/\/$/, "");
}

/** "~/code/cline · github.com/cline/cline · PRs target main" */
export function locationLine(project: FactoryProjectSummary): string {
	return [
		tildePath(project.workspaceRoot),
		shortRemote(project.remote),
		project.defaultBranch ? P.prTarget(project.defaultBranch) : undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

export const roleNames = (roles: readonly string[]) =>
	roles
		.map(
			(role) => FS_GUIDANCE_ROLE[role as keyof typeof FS_GUIDANCE_ROLE] ?? role,
		)
		.join(", ");

/** "12 open cards · 2 stages · test setup proposed · guidance for Builder, Reviewer" */
export function statusLine(project: FactoryProjectSummary): string {
	const parts = [
		project.cards ? P.openCards(project.cards.open) : undefined,
		P.stages(project.stages.total),
		P.testSetup[project.verification],
		project.guidance.roles.length
			? P.guidanceFor(roleNames(project.guidance.roles))
			: P.noGuidance,
	].filter((part): part is string => Boolean(part));
	const line = parts.join(" · ");
	return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * The list's pill: the worst thing about the project. Something waiting for
 * the person first (stages, test setup, guidance changed outside Factory),
 * then "Ready" when anything is set up, else "Nothing set up".
 */
export function worstStatus(project: FactoryProjectSummary): {
	tone: FactoryTone;
	text: string;
} {
	const { stages, verification, guidance } = project;
	if (stages.file === "invalid")
		return { tone: "danger", text: P.pill.stagesInvalid };
	if (verification === "invalid")
		return { tone: "danger", text: P.pill.testSetupInvalid };
	if (stages.awaiting > 0)
		return { tone: "attention", text: P.pill.stagesAwaiting(stages.awaiting) };
	if (verification === "changed")
		return { tone: "attention", text: P.pill.testSetupChanged };
	if (verification === "proposed")
		return { tone: "attention", text: P.pill.testSetupProposed };
	if (guidance.changed.length > 0)
		return { tone: "attention", text: P.pill.guidanceChanged };
	if (
		stages.total > 0 ||
		verification === "in_use" ||
		guidance.roles.length > 0
	)
		return { tone: "success", text: P.pill.ready };
	return { tone: "neutral", text: P.pill.nothing };
}
