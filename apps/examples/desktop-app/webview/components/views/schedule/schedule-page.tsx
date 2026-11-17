"use client";

import {
	AlertDialog,
	Banner,
	Button,
	EmptyState,
	IconButton,
	SectionHeading,
} from "@cline/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";

import { useScrollHeaderFade } from "@/hooks/use-scroll-header-fade";
import { useDetailNavigation } from "@/lib/detail-navigation";
import { cn } from "@/lib/utils";
import { PageFrame, PageShell } from "../page-layout";
import { queryScrollViewports } from "../shared/page-scroll";
import { PaginationFooter } from "../shared/pagination-footer";
import { usePagination } from "../shared/use-pagination";
import { useReturnPosition } from "../shared/use-return-position";
import { ScheduleEditorPage } from "./editor/schedule-editor-page";
import { useScheduleEditor } from "./editor/use-schedule-editor";
import { ScheduleList } from "./schedule-list";
import styles from "./schedule-page.module.css";

import { ScheduleSuggestions } from "./schedule-suggestions";
import {
	SCHEDULE_TEMPLATES,
	type ScheduleTemplate,
} from "./schedule-templates";
import type { Schedule } from "./schedule-types";
import { useSchedules } from "./use-schedules";

const SCHEDULE_PAGE_SIZE = 20;

/** What the editor is open on, as one step of Back/Forward history. */
type ScheduleDetail =
	| { kind: "create"; template?: ScheduleTemplate }
	| { kind: "edit"; scheduleId: string };

export function SchedulePage({
	onOpenSession,
}: {
	onOpenSession?: (sessionId: string) => void | Promise<void>;
}) {
	const schedulesModel = useSchedules();
	const {
		schedules,
		activeExecutions,
		lastExecutions,
		isLoading,
		loadError,
		actionError,
		busyScheduleIds,
		triggeringScheduleIds,
		schedulePendingDelete,
		setSchedulePendingDelete,
		refreshSchedules,
		setScheduleEnabled,
		triggerSchedule,
		deleteSchedule,
	} = schedulesModel;
	const editor = useScheduleEditor(schedulesModel);
	// Background work reads the editor as it is when the work finishes.
	const editorRef = useRef(editor);
	editorRef.current = editor;
	const listRef = useRef<HTMLDivElement>(null);
	const manageHeadingRef = useRef<HTMLDivElement>(null);
	useScrollHeaderFade(manageHeadingRef);
	const newScheduleRef = useRef<HTMLButtonElement>(null);
	const { remember, restore } = useReturnPosition();
	const rememberPosition = (trigger?: HTMLButtonElement) => {
		remember(
			trigger ??
				(document.activeElement instanceof HTMLElement
					? document.activeElement
					: null),
			queryScrollViewports(listRef.current)[0] ?? null,
		);
	};
	const {
		detail,
		open: openDetail,
		replace: replaceDetail,
		close: closeDetail,
	} = useDetailNavigation<ScheduleDetail>();
	const openCreate = (
		template?: ScheduleTemplate,
		trigger?: HTMLButtonElement,
	) => {
		rememberPosition(trigger);
		openDetail({ kind: "create", template });
	};
	const openEdit = (schedule: Schedule, trigger?: HTMLButtonElement) => {
		rememberPosition(trigger);
		openDetail({ kind: "edit", scheduleId: schedule.scheduleId });
	};
	// The editor follows the detail in history, so Back and Forward step
	// through it like any other place in the app.
	const shownDetail = useRef<ScheduleDetail | null>(null);
	const editingScheduleId = editor.editingSchedule?.scheduleId;
	useLayoutEffect(() => {
		if (detail === shownDetail.current) return;
		if (!detail) {
			shownDetail.current = null;
			editor.dismissEditor();
		} else if (detail.kind === "create") {
			shownDetail.current = detail;
			void editor.openCreate(detail.template);
		} else {
			const schedule = schedules.find(
				(item) => item.scheduleId === detail.scheduleId,
			);
			if (schedule) {
				shownDetail.current = detail;
				editor.openEdit(schedule);
			} else if (!isLoading) {
				// Deleted since this step was recorded: nothing left to show.
				closeDetail({ forget: true });
			}
		}
	});
	useLayoutEffect(() => {
		// Once a new schedule is saved, coming back to this step should reopen it.
		if (detail?.kind !== "create" || !editingScheduleId) return;
		const saved: ScheduleDetail = {
			kind: "edit",
			scheduleId: editingScheduleId,
		};
		shownDetail.current = saved;
		replaceDetail(saved);
	}, [detail, editingScheduleId, replaceDetail]);
	useLayoutEffect(() => {
		if (editor.isOpen) return;
		restore(() => newScheduleRef.current?.focus({ preventScroll: true }));
	}, [editor.isOpen, restore]);

	const sortedSchedules = useMemo(
		() =>
			[...schedules].sort((a, b) =>
				a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
			),
		[schedules],
	);
	const pagination = usePagination({
		total: sortedSchedules.length,
		pageSize: SCHEDULE_PAGE_SIZE,
	});
	const visibleSchedules = sortedSchedules.slice(
		pagination.offset,
		pagination.offset + SCHEDULE_PAGE_SIZE,
	);
	const executions = useMemo(
		() => [...lastExecutions, ...activeExecutions],
		[lastExecutions, activeExecutions],
	);

	// Hide suggestions the user has already created (matched by schedule name).
	const visibleTemplates = useMemo(() => {
		const existingNames = new Set(
			schedules.map((schedule) => schedule.name.trim().toLowerCase()),
		);
		return SCHEDULE_TEMPLATES.filter(
			(template) => !existingNames.has(template.name.trim().toLowerCase()),
		);
	}, [schedules]);

	const isDeleting = schedulePendingDelete
		? busyScheduleIds.has(schedulePendingDelete.scheduleId)
		: false;
	const confirmDelete = async () => {
		if (!schedulePendingDelete) return;
		const { scheduleId } = schedulePendingDelete;
		const deleted = await deleteSchedule(scheduleId);
		if (
			deleted &&
			editorRef.current.editingSchedule?.scheduleId === scheduleId
		) {
			editorRef.current.dismissEditor();
			closeDetail({ forget: true });
		}
	};
	const pageError = actionError ?? loadError;

	return (
		<PageShell
			className={cn(
				"cline-schedules-content",
				editor.isSaving && styles.saving,
			)}
		>
			<div
				ref={listRef}
				hidden={editor.isOpen}
				className="h-full min-h-0 overflow-hidden"
			>
				<PageFrame
					className={styles.frame}
					headerFade
					header={{
						description:
							"Run agents on cron schedules for recurring automations.",
						title: "Schedule",
						actions: (
							<>
								<IconButton
									aria-label="Refresh schedules"
									variant="ghost"
									tone="neutral"
									size="sm"
									onClick={() => void refreshSchedules()}
									disabled={isLoading}
									icon={RefreshCw}
									loading={isLoading}
									loadingIcon={RefreshCw}
								/>
								<Button
									size="sm"
									ref={newScheduleRef}
									onClick={(event) =>
										openCreate(undefined, event.currentTarget)
									}
									leadingIcon={Plus}
								>
									New schedule
								</Button>
							</>
						),
					}}
					windowTitleBar
				>
					{pageError && (
						<Banner className="mb-4" tone="error">
							{pageError}
						</Banner>
					)}

					<div className="flex min-w-0 flex-col gap-11">
						<section
							aria-labelledby="my-schedules-heading"
							aria-busy={isLoading}
							className="min-w-0"
						>
							<SectionHeading
								ref={manageHeadingRef}
								className="sticky top-(--page-header-height) z-10 -my-2 mb-5 bg-background"
								title={<span id="my-schedules-heading">Manage</span>}
							/>
							{isLoading ? (
								<EmptyState align="center" role="status">
									Loading schedules…
								</EmptyState>
							) : sortedSchedules.length === 0 ? (
								<EmptyState
									align="center"
									title={
										loadError ? "Schedules unavailable" : "No schedules yet"
									}
									size={loadError ? "md" : "lg"}
									surface={loadError ? "muted" : "transparent"}
									className={loadError ? "gap-3 p-5" : undefined}
									action={
										loadError
											? {
													label: "Try again",
													onClick: () => void refreshSchedules(),
												}
											: {
													label: "New schedule",
													onClick: (event) =>
														openCreate(undefined, event.currentTarget),
												}
									}
								/>
							) : (
								<div
									ref={pagination.contentRef}
									className="grid min-w-0 grid-rows-[1fr_auto] items-start [overflow-anchor:none]"
								>
									<ScheduleList
										schedules={visibleSchedules}
										executions={executions}
										busyScheduleIds={busyScheduleIds}
										onOpen={openEdit}
										onEnabledChange={(schedule, enabled) => {
											void setScheduleEnabled(schedule, enabled);
										}}
									/>
									<PaginationFooter
										aria-label="Schedule pages"
										itemLabel="schedules"
										page={pagination.page}
										pageSize={SCHEDULE_PAGE_SIZE}
										total={sortedSchedules.length}
										onPageChange={pagination.onPageChange}
									/>
								</div>
							)}
						</section>
						{!isLoading && (
							<ScheduleSuggestions
								templates={visibleTemplates}
								onSelect={openCreate}
							/>
						)}
					</div>
				</PageFrame>
			</div>
			{editor.isOpen ? (
				<ScheduleEditorPage
					editor={editor}
					isBusy={
						editingScheduleId ? busyScheduleIds.has(editingScheduleId) : false
					}
					isTriggering={
						editingScheduleId
							? triggeringScheduleIds.has(editingScheduleId)
							: false
					}
					onRun={triggerSchedule}
					onBack={() => closeDetail()}
					onDelete={setSchedulePendingDelete}
					actionError={actionError}
					executions={executions}
					onOpenSession={onOpenSession}
				/>
			) : null}
			<AlertDialog
				open={Boolean(schedulePendingDelete)}
				onOpenChange={(open) => {
					if (!open) setSchedulePendingDelete(null);
				}}
				title="Delete schedule?"
				description={
					<>
						This will delete "{schedulePendingDelete?.name ?? "this schedule"}"
						and remove future scheduled runs.
					</>
				}
				confirmLabel="Delete"
				confirmTone="destructive"
				confirmDisabled={!schedulePendingDelete || isDeleting}
				cancelDisabled={isDeleting}
				onConfirm={() => void confirmDelete()}
			/>
		</PageShell>
	);
}
