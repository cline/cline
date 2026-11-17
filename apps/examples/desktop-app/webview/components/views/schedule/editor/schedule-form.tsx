import { Badge, DetailList, DetailListItem, SegmentedControl } from "@cline/ui";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AdvancedSection } from "../../shared/advanced-section";
import styles from "../../shared/form-controls.module.css";
import { SCHEDULE_FIELD_IDS } from "./schedule-field-ids";
import { ScheduleInstructionsField } from "./schedule-instructions-field";
import { ScheduleModelFields } from "./schedule-model-fields";
import { ScheduleTriggerFields } from "./schedule-trigger-fields";
import { ScheduleWorkspaceField } from "./schedule-workspace-field";
import type { ScheduleEditor } from "./use-schedule-editor";

const MODE_DESCRIPTIONS = {
	act: "Execute the task using the standard tools.",
	plan: "Focus on analysis and planning.",
	yolo: "Use the streamlined automation tools.",
};

/** Settings stay mounted while viewing runs so the draft and field state survive. */
export function ScheduleForm({
	editor,
	isBusy = false,
}: {
	editor: ScheduleEditor;
	isBusy?: boolean;
}) {
	const { form, setForm, isSaving, validation } = editor;
	const disabled = isSaving || isBusy;
	const [advancedExpanded, setAdvancedExpanded] = useState(false);
	const isTimeoutInvalid = validation?.field === "timeoutSeconds";
	// A flagged field must be reachable, so its section opens with the message.
	const advancedOpen = advancedExpanded || isTimeoutInvalid;
	const instructionsLabelId = useId();
	return (
		<fieldset disabled={disabled} className="flex min-w-0 flex-col gap-8">
			<legend className="sr-only">Schedule settings</legend>
			<DetailList>
				<ScheduleTriggerFields editor={editor} disabled={disabled} />
				<ScheduleWorkspaceField
					value={form.workspaceRoot}
					onChange={(workspaceRoot) =>
						setForm((prev) => ({ ...prev, workspaceRoot }))
					}
					disabled={disabled}
					invalid={validation?.field === "workspaceRoot"}
				/>
				<ScheduleModelFields editor={editor} disabled={disabled} />
			</DetailList>
			<section
				aria-labelledby={instructionsLabelId}
				className="min-w-0 space-y-4"
			>
				<ScheduleInstructionsField
					labelId={instructionsLabelId}
					value={form.prompt}
					onChange={(prompt) => setForm((prev) => ({ ...prev, prompt }))}
					invalid={validation?.field === "prompt"}
				/>
				<p className="text-sm text-muted-foreground">
					Scheduled tasks run without approval prompts. Enabled tools may edit
					files and run commands.
				</p>
			</section>
			<AdvancedSection
				id="schedule-advanced"
				open={advancedOpen}
				onOpenChange={setAdvancedExpanded}
			>
				<div className="grid min-w-0 gap-5">
					<DetailList>
						<DetailListItem
							title={
								<span id={`${SCHEDULE_FIELD_IDS.mode}-label`}>
									Execution mode
								</span>
							}
							description={
								<span id={`${SCHEDULE_FIELD_IDS.mode}-description`}>
									{MODE_DESCRIPTIONS[form.mode]}
								</span>
							}
							actions={
								<SegmentedControl
									id={SCHEDULE_FIELD_IDS.mode}
									aria-labelledby={`${SCHEDULE_FIELD_IDS.mode}-label`}
									aria-describedby={`${SCHEDULE_FIELD_IDS.mode}-description`}
									className="w-64 max-w-full"
									size="sm"
									options={[
										{ value: "act", label: "Act" },
										{ value: "plan", label: "Plan" },
										{ value: "yolo", label: "YOLO" },
									]}
									value={form.mode}
									disabled={disabled}
									onValueChange={(mode) => {
										if (
											!disabled &&
											(mode === "act" || mode === "plan" || mode === "yolo")
										) {
											setForm((prev) => ({ ...prev, mode }));
										}
									}}
								/>
							}
						/>
						<DetailListItem
							title={
								<Label htmlFor={SCHEDULE_FIELD_IDS.timeout}>
									Timeout seconds <Badge size="xxs">Optional</Badge>
								</Label>
							}
							actions={
								<Input
									id={SCHEDULE_FIELD_IDS.timeout}
									aria-invalid={isTimeoutInvalid || undefined}
									className={cn(styles.control, "w-64 max-w-full")}
									inputMode="numeric"
									value={form.timeoutSeconds}
									onChange={(event) =>
										setForm((prev) => ({
											...prev,
											timeoutSeconds: event.target.value,
										}))
									}
									placeholder="3600"
								/>
							}
						/>
						<DetailListItem
							title={
								<Label htmlFor={SCHEDULE_FIELD_IDS.tags}>
									Tags (comma-separated) <Badge size="xxs">Optional</Badge>
								</Label>
							}
							actions={
								<Input
									id={SCHEDULE_FIELD_IDS.tags}
									className={cn(styles.control, "w-64 max-w-full")}
									value={form.tags}
									onChange={(event) =>
										setForm((prev) => ({ ...prev, tags: event.target.value }))
									}
									placeholder="automation,review"
								/>
							}
						/>
						<DetailListItem
							title={
								<Label htmlFor={SCHEDULE_FIELD_IDS.systemPrompt}>
									System instructions <Badge size="xxs">Optional</Badge>
								</Label>
							}
							description={
								<Textarea
									id={SCHEDULE_FIELD_IDS.systemPrompt}
									className={cn(styles.control, "mt-1.5")}
									rows={3}
									value={form.systemPrompt}
									onChange={(event) =>
										setForm((prev) => ({
											...prev,
											systemPrompt: event.target.value,
										}))
									}
								/>
							}
						/>
					</DetailList>
				</div>
			</AdvancedSection>
		</fieldset>
	);
}
