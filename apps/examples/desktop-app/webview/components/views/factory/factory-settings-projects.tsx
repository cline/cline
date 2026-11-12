"use client";

import { basenamePath } from "@/hooks/use-session-history";
import { FACTORY_SETTINGS } from "@/lib/factory-copy";
import {
	GroupHeading,
	SectionTitle,
	SettingRow,
	SettingSelect,
} from "./factory-settings-rows";
import {
	type FactoryStages,
	FactoryStagesSettings,
} from "./factory-stages-settings";

/**
 * One project at a time: its repository stages (one decision each), and
 * read-only pointers to its guidance and test setup, which change through
 * Ask Factory. No sidecar read exists yet for either value, so those rows
 * carry no value on the right.
 */
export function FactorySettingsProjects({
	headingId,
	projects,
	project,
	onProjectChange,
	stages,
}: {
	headingId: string;
	projects: readonly string[];
	project: string | undefined;
	onProjectChange: (project: string) => void;
	/** Every project's stages, read once by the page for its count too. */
	stages: FactoryStages;
}) {
	const P = FACTORY_SETTINGS.projects;
	if (!project)
		return (
			<SectionTitle
				id={headingId}
				title={FACTORY_SETTINGS.sections.projects}
				scope={P.none}
			/>
		);
	return (
		<>
			<SectionTitle
				id={headingId}
				title={FACTORY_SETTINGS.sections.projects}
				scope={P.scope(basenamePath(project), project)}
				action={
					projects.length > 1 ? (
						<>
							<span id="project-title" className="sr-only">
								{P.select}
							</span>
							<SettingSelect
								id="project"
								value={project}
								options={projects.map((root) => ({
									value: root,
									label: basenamePath(root),
								}))}
								onChange={onProjectChange}
							/>
						</>
					) : null
				}
			/>
			<GroupHeading hint={P.stagesGroupHint}>{P.stagesGroup}</GroupHeading>
			<FactoryStagesSettings
				key={project}
				workspaceRoot={project}
				stages={stages}
			/>
			<GroupHeading>{P.guidanceGroup}</GroupHeading>
			<SettingRow
				id="guidance"
				title={P.guidance}
				description={P.guidanceHint}
			/>
			<SettingRow
				id="testSetup"
				title={P.testSetup}
				description={P.testSetupHint}
			/>
		</>
	);
}
