"use client";

import type { FactoryProjectSummary } from "@/lib/factory-settings-client";
import { GroupHeading, OpenRow } from "../../../factory-settings-rows";
import type { FactoryTone } from "../../../factory-ui";
import type { SettingsPageId, SettingsShell } from "../../types";

/**
 * "Other projects": one Open row per other project Factory knows, opening
 * the same page with that project selected. Hidden with one project.
 */
export function OtherProjects({
	shell,
	page,
	title,
	describe,
}: {
	shell: SettingsShell;
	page: Extract<SettingsPageId, "stages" | "verification">;
	title: string;
	describe: (project: FactoryProjectSummary) => {
		description: string;
		pill?: { tone: FactoryTone; text: string };
		label?: string;
	};
}) {
	const others = (shell.projectsSummary.data?.projects ?? []).filter(
		(project) =>
			project.workspaceRoot !== shell.project &&
			shell.projects.includes(project.workspaceRoot),
	);
	if (!others.length) return null;
	return (
		<>
			<GroupHeading>{title}</GroupHeading>
			{others.map((project) => {
				const { description, pill, label } = describe(project);
				return (
					<OpenRow
						key={project.workspaceRoot}
						id={`${page}-project-${project.name}`}
						title={project.name}
						description={description}
						pill={pill}
						label={label}
						onOpen={() => shell.open({ page, project: project.workspaceRoot })}
					/>
				);
			})}
		</>
	);
}
