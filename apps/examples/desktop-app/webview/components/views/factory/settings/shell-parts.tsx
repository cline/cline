"use client";

import { basenamePath } from "@/hooks/use-session-history";
import { FACTORY_SETTINGS } from "@/lib/factory-copy";
import { FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { ActionButton, SettingSelect } from "../factory-settings-rows";
import type { DefaultWorkflow } from "./default-workflow";
import type { SettingsShell } from "./types";

/** Under the scope line when the saved workflows could not be read. */
export function WorkflowLoadError({
	workflow,
}: {
	workflow: Pick<DefaultWorkflow, "presets">;
}) {
	const error = workflow.presets.error;
	if (!error) return null;
	return (
		<p
			role="alert"
			className="mt-2 flex items-center gap-2 text-xs text-destructive"
		>
			<span>
				{FACTORY_SETTINGS.loadFailed} {error}
			</span>
			<ActionButton
				disabled={workflow.presets.loading}
				onClick={workflow.presets.reload}
			>
				{FACTORY_SETTINGS.reload}
			</ActionButton>
		</p>
	);
}

/**
 * The shared project select at the right of a project-scoped page's title
 * (Stages, Test setup, Guidance's repository half). Hidden with one project.
 */
export function ProjectSelect({ shell }: { shell: SettingsShell }) {
	if (shell.projects.length < 2 || !shell.project) return null;
	return (
		<div data-setting="settings-project">
			<span id="settings-project-title" className="sr-only">
				{FS_SHELL.project}
			</span>
			<SettingSelect
				id="settings-project"
				className="min-w-0"
				value={shell.project}
				options={shell.projects.map((root) => ({
					value: root,
					label: basenamePath(root),
				}))}
				onChange={shell.setProject}
			/>
		</div>
	);
}
