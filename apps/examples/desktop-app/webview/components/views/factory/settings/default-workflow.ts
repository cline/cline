"use client";

import {
	type FactoryTaskConfig,
	type FactoryWorkflowConfig,
	factoryRequiresIndependentReview,
	factoryReviewMode,
	factoryWorkflowConfigSchema,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import { useCallback, useRef, useState } from "react";
import { useFactoryPresets } from "@/hooks/use-factory-presets";
import { FACTORY_SETTINGS } from "@/lib/factory-copy";
import {
	HANDS_OFF_PRESET_CONFIG,
	HANDS_OFF_PRESET_NAME,
} from "@/lib/factory-presets";
import { factorySettingsClient } from "@/lib/factory-settings-client";
import { withHandsOff } from "../factory-workflow-editor";

/** A workflow row's change: the next config and the row that made it. */
export type CommitWorkflow = (next: FactoryWorkflowConfig, row: string) => void;

/**
 * The default workflow for new work, saved on every change through
 * `factory_save_preset` (the default in use, else the built-in Hands-off
 * workflow, kept as the default). A change shows at once; a rejected save
 * returns to the last saved value and reports under the row that made it.
 * `draft` holds edits not saved yet (`edit`, then `flush` saves them).
 */
export function useDefaultWorkflow(onSaved: () => void) {
	const presets = useFactoryPresets();
	const { setPresets, setDefaultPreset } = presets;
	const name =
		presets.defaultPreset &&
		presets.presets.some((preset) => preset.name === presets.defaultPreset)
			? presets.defaultPreset
			: HANDS_OFF_PRESET_NAME;
	const stored: FactoryWorkflowConfig =
		presets.presets.find((preset) => preset.name === name)?.config ??
		HANDS_OFF_PRESET_CONFIG;
	const [draft, setDraft] = useState<FactoryWorkflowConfig>();
	const [rowError, setRowError] = useState<{ row: string; message: string }>();
	const latest = useRef(0);
	const commit = useCallback<CommitWorkflow>(
		(next, row) => {
			const attempt = ++latest.current;
			setDraft(next);
			setRowError(undefined);
			void Promise.resolve()
				.then(() =>
					factorySettingsClient.savePreset({
						name,
						config: factoryWorkflowConfigSchema.parse(next),
						useByDefault: true,
					}),
				)
				.then(
					(items) => {
						setPresets(items);
						setDefaultPreset(name);
						if (attempt === latest.current) onSaved();
						setDraft((current) => (current === next ? undefined : current));
					},
					(cause: unknown) => {
						if (attempt !== latest.current) return;
						setDraft(undefined);
						setRowError({
							row,
							message:
								cause instanceof Error && cause.message
									? cause.message
									: FACTORY_SETTINGS.saveFailed,
						});
					},
				);
		},
		[name, onSaved, setPresets, setDefaultPreset],
	);
	return {
		config: draft ?? stored,
		/** Shows an edit without saving it; `flush` saves it. */
		edit: setDraft,
		flush: (row: string) => {
			if (draft && draft !== stored) commit(draft, row);
		},
		commit,
		errorFor: (row: string) =>
			rowError?.row === row ? rowError.message : undefined,
		presets,
		name,
	};
}
export type DefaultWorkflow = ReturnType<typeof useDefaultWorkflow>;

/** The review policy in effect: unset is by risk when hands-off, else always. */
export function effectiveDraftReview(
	config: FactoryWorkflowConfig,
): NonNullable<FactoryWorkflowConfig["humanStamp"]> {
	return (
		config.humanStamp ?? (isFactoryHandsOff(config) ? "by_risk" : "always")
	);
}

/**
 * Update on an older workflow: turns hands-off on and pins every value the
 * page was showing, so only retry and re-scoping change.
 */
export function updateOlderWorkflow(
	config: FactoryWorkflowConfig,
): FactoryWorkflowConfig {
	return factoryWorkflowConfigSchema.parse(
		withHandsOff(
			{
				...config,
				humanStamp: effectiveDraftReview(config),
				reviewMode: factoryReviewMode(config),
				requireIndependentReview: factoryRequiresIndependentReview(config),
			} as FactoryTaskConfig,
			true,
		),
	);
}
