"use client";

import {
	Banner,
	Button,
	PillSelector,
	PillSelectorItem,
	Switch,
} from "@cline/ui";
import { Check, CircleAlert, Play, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import {
	markScheduleRunsRead,
	useHasUnreadScheduleRun,
} from "@/hooks/use-schedule-run-notifications";
import { useTextareaAutosize } from "@/hooks/use-textarea-autosize";
import { useUnsavedChangesGuard } from "@/lib/unsaved-changes";
import { DetailPage } from "../../shared/detail-page";
import { DiscardChangesDialog } from "../../shared/discard-changes-dialog";
import { EditableTitle } from "../../shared/editable-title";
import { ItemDetails } from "../../shared/item-details";
import {
	getScheduleExecutions,
	hasExecutionError,
} from "../schedule-executions";
import { ScheduleRuns } from "../schedule-runs";
import type { Schedule, ScheduleExecution } from "../schedule-types";
import {
	SCHEDULE_FIELD_IDS,
	SCHEDULE_ISSUE_FIELD_IDS,
} from "./schedule-field-ids";
import { ScheduleForm } from "./schedule-form";
import type { ScheduleEditor } from "./use-schedule-editor";

type ScheduleEditorSection = "settings" | "runs";

export function ScheduleEditorPage({
	editor,
	executions,
	onOpenSession,
	isBusy = false,
	isTriggering = false,
	actionError,
	onBack,
	onRun,
	onDelete,
}: {
	editor: ScheduleEditor;
	/** Return to the schedule list; called once any unsaved changes are settled. */
	onBack: () => void;
	executions: ScheduleExecution[];
	onOpenSession?: (sessionId: string) => void | Promise<void>;
	/** An action on this schedule (run, delete, enable) is in flight. */
	isBusy?: boolean;
	isTriggering?: boolean;
	/** The last failed action on this schedule; load failures stay on the list. */
	actionError?: string | null;
	onRun?: (schedule: Schedule) => boolean | Promise<boolean>;
	onDelete?: (schedule: Schedule) => void;
}) {
	const [section, setSection] = useState<ScheduleEditorSection>(() =>
		getScheduleExecutions(editor.editingSchedule?.scheduleId, executions)
			.length > 0
			? "runs"
			: "settings",
	);
	const toggleId = useId();
	const [isEditingHeader, setIsEditingHeader] = useState(false);
	const [isStartingRun, setIsStartingRun] = useState(false);
	const startingRunRef = useRef(false);
	const errorRef = useRef<HTMLDivElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	const {
		form,
		setForm,
		isSaving,
		isSaved,
		isChangingEnabled,
		error,
		validation,
		editingSchedule,
		save,
	} = editor;
	const unsavedChanges = useUnsavedChangesGuard(editor.hasUnsavedChangesNow);
	useTextareaAutosize(descriptionRef, form.description);
	const title = form.name.trim() || "New schedule";
	const activeSection = editingSchedule ? section : "settings";
	const hasUnreadRun = useHasUnreadScheduleRun(editingSchedule?.scheduleId);
	const showUnreadRun = hasUnreadRun && activeSection !== "runs";
	const hasRunErrors = getScheduleExecutions(
		editingSchedule?.scheduleId,
		executions,
	).some(hasExecutionError);
	const runsDescription =
		[
			showUnreadRun ? "New run available." : "",
			hasRunErrors ? "Some recent runs have errors." : "",
		]
			.filter(Boolean)
			.join(" ") || undefined;
	const visibleError = error || actionError;
	// Toggling Enable is its own small request: it must not lock the draft.
	const isActionPending =
		isSaving || isStartingRun || (isBusy && !isChangingEnabled);
	const isRunStarting = isStartingRun || isTriggering;
	const runNow = async () => {
		if (!editingSchedule || !onRun || isActionPending || startingRunRef.current)
			return;
		startingRunRef.current = true;
		setIsStartingRun(true);
		try {
			await editor.whenEnabledSettled();
			// The runner reads the persisted schedule, so commit this draft first.
			if (editor.hasUnsavedChanges && !(await save())) return;
			if (await onRun({ ...editingSchedule, name: form.name.trim() })) {
				setSection("runs");
			}
		} finally {
			startingRunRef.current = false;
			setIsStartingRun(false);
		}
	};
	// A new schedule starts at its name; an existing one starts at Back.
	const isNewSchedule = useRef(!editingSchedule).current;
	useEffect(() => {
		if (isNewSchedule) nameRef.current?.focus({ preventScroll: true });
	}, [isNewSchedule]);
	// A message about one field sends focus to that field.
	useEffect(() => {
		if (validation) setSection("settings");
	}, [validation]);
	useEffect(() => {
		if (activeSection === "runs" && hasUnreadRun) {
			markScheduleRunsRead(editingSchedule?.scheduleId);
		}
	}, [activeSection, editingSchedule?.scheduleId, hasUnreadRun]);
	useEffect(() => {
		if (!validation || activeSection !== "settings") return;
		document
			.getElementById(SCHEDULE_ISSUE_FIELD_IDS[validation.field])
			?.focus();
	}, [validation, activeSection]);
	// Any other failure follows something the reader just did, so move to it.
	useEffect(() => {
		if (!visibleError || validation) return;
		errorRef.current?.focus();
	}, [visibleError, validation]);
	const headerActions = (
		<>
			{editingSchedule && onRun ? (
				<Button
					type="button"
					leadingIcon={Play}
					loading={isRunStarting}
					loadingIcon={RefreshCw}
					variant="secondary"
					tone="neutral"
					size="sm"
					disabled={isActionPending}
					onClick={() => void runNow()}
				>
					{isRunStarting
						? "Starting…"
						: editor.hasUnsavedChanges
							? "Save and run"
							: "Run now"}
				</Button>
			) : null}
			<Button
				type="submit"
				size="sm"
				tone="neutral"
				disabled={isActionPending}
				aria-busy={isSaving}
				aria-live="polite"
				className="[&_[data-icon=leading]]:text-(--success-6)"
				leadingIcon={isSaved ? Check : undefined}
			>
				{isSaving ? "Saving…" : isSaved ? "Saved" : "Save"}
			</Button>
		</>
	);
	return (
		<DetailPage
			backLabel="Schedule"
			onBack={() => unsavedChanges.requestLeave(onBack)}
			backDisabled={isActionPending}
			focusBackOnMount={!isNewSchedule}
			navigationLabel="Schedule navigation"
		>
			<form
				noValidate
				aria-label={editingSchedule ? "Edit schedule" : "New schedule"}
				onSubmit={(event) => {
					event.preventDefault();
					if (isActionPending || startingRunRef.current) return;
					void save();
				}}
			>
				<ItemDetails
					title={title}
					headerActions={headerActions}
					actions={
						editingSchedule && onDelete ? (
							<Button
								type="button"
								aria-label={`Delete ${editingSchedule.name}`}
								leadingIcon={Trash2}
								variant="secondary"
								tone="destructive"
								size="sm"
								disabled={isActionPending}
								onClick={() => onDelete(editingSchedule)}
							>
								Delete
							</Button>
						) : undefined
					}
					leadingActions={
						editingSchedule ? (
							<label
								className="flex cursor-pointer items-center gap-3"
								htmlFor={toggleId}
							>
								<Switch
									tone="neutral"
									id={toggleId}
									aria-label={`Enable ${editingSchedule.name}`}
									checked={form.enabled}
									pending={isChangingEnabled}
									disabled={isActionPending}
									onCheckedChange={(enabled) =>
										void editor.changeEnabled(enabled)
									}
								/>
								<span className="text-sm">Enable</span>
							</label>
						) : undefined
					}
					renderHeader={(titleRef, actions) => (
						<fieldset
							aria-label="Schedule details"
							className="min-w-0 space-y-2"
							onBlur={(event) => {
								if (!event.currentTarget.contains(event.relatedTarget)) {
									setIsEditingHeader(false);
								}
							}}
						>
							<div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
								<EditableTitle
									titleRef={titleRef}
									inputRef={nameRef}
									id={SCHEDULE_FIELD_IDS.name}
									title={title}
									label="Schedule name"
									placeholder="Schedule name"
									value={form.name}
									onChange={(name) => setForm((prev) => ({ ...prev, name }))}
									onFocus={() => setIsEditingHeader(true)}
									disabled={isActionPending}
									invalid={validation?.field === "name"}
								/>
								{actions}
							</div>
							{form.description.trim() || isEditingHeader ? (
								<Textarea
									ref={descriptionRef}
									id={SCHEDULE_FIELD_IDS.description}
									aria-label="Schedule description"
									placeholder="Description"
									disabled={isActionPending}
									rows={1}
									onFocus={() => setIsEditingHeader(true)}
									value={form.description}
									onChange={(event) =>
										setForm((prev) => ({
											...prev,
											description: event.target.value,
										}))
									}
									className="-ml-1 min-h-0 max-h-32 resize-none overflow-y-auto border-transparent bg-transparent px-1 py-0 text-muted-foreground text-sm shadow-none dark:bg-transparent"
								/>
							) : null}
						</fieldset>
					)}
					feedback={
						visibleError ? (
							<div
								ref={errorRef}
								tabIndex={-1}
								className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
							>
								<Banner tone="error">{visibleError}</Banner>
							</div>
						) : null
					}
				>
					{editingSchedule && (
						<PillSelector
							aria-label="Schedule sections"
							value={activeSection}
							onValueChange={(value) => {
								if (value === "settings" || value === "runs") setSection(value);
							}}
						>
							<PillSelectorItem
								value="settings"
								aria-controls="schedule-settings"
							>
								Settings
							</PillSelectorItem>
							<PillSelectorItem
								value="runs"
								aria-controls="schedule-runs"
								aria-description={runsDescription}
								title={runsDescription}
							>
								Runs
								{showUnreadRun && (
									<span
										aria-hidden="true"
										className="size-1.5 shrink-0 rounded-full bg-cline-ui-info-solid"
										data-schedule-run-status="unread"
									/>
								)}
								{hasRunErrors && (
									<CircleAlert
										aria-hidden="true"
										className="size-4 shrink-0 text-error-text"
									/>
								)}
							</PillSelectorItem>
						</PillSelector>
					)}
					<div id="schedule-settings" hidden={activeSection !== "settings"}>
						<ScheduleForm editor={editor} isBusy={isActionPending} />
					</div>
					{editingSchedule && (
						<div id="schedule-runs" hidden={activeSection !== "runs"}>
							<ScheduleRuns
								scheduleId={editingSchedule.scheduleId}
								executions={executions}
								onOpenSession={
									onOpenSession
										? (sessionId) =>
												unsavedChanges.requestLeave(() => {
													void onOpenSession(sessionId);
												})
										: undefined
								}
							/>
						</div>
					)}
				</ItemDetails>
			</form>
			<DiscardChangesDialog
				guard={unsavedChanges}
				description={
					editingSchedule
						? `Your edits to "${editingSchedule.name}" have not been saved.`
						: "This schedule has not been saved."
				}
			/>
		</DetailPage>
	);
}
