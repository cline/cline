"use client";

import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useIsMounted } from "@/hooks/use-is-mounted";
import { desktopClient } from "@/lib/desktop-client";
import type { ScheduleTemplate } from "../schedule-templates";
import type { Schedule, ScheduleFormState } from "../schedule-types";
import type { useSchedules } from "../use-schedules";
import {
	lookUpModelSelection,
	lookUpProjectFolder,
	newScheduleForm,
	readRememberedChoices,
} from "./schedule-form-defaults";
import {
	buildSchedulePayload,
	createDefaultScheduleForm,
	formFromSchedule,
	hasSameTiming,
	isSameForm,
	SCHEDULE_FIELD_FORM_KEYS,
	type ScheduleFormIssue,
	validateScheduleForm,
} from "./schedule-form-model";

const SAVED_CONFIRMATION_MS = 3_000;

export function useScheduleEditor({
	schedules,
	refreshSchedules,
	clearActionError,
	setScheduleEnabled,
}: Pick<
	ReturnType<typeof useSchedules>,
	"schedules" | "refreshSchedules" | "clearActionError" | "setScheduleEnabled"
>) {
	const [isOpen, setIsOpen] = useState(false);
	const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [isSaved, setIsSaved] = useState(false);
	const [isChangingEnabled, setIsChangingEnabled] = useState(false);

	const [requestError, setRequestError] = useState<string | null>(null);
	const [validation, setValidation] = useState<ScheduleFormIssue | null>(null);
	const [form, setFormState] = useState<ScheduleFormState>(
		createDefaultScheduleForm,
	);
	const mountedRef = useIsMounted();
	const editorSequence = useRef(0);
	const savingRef = useRef(false);
	const openRef = useRef(false);
	const formRef = useRef(form);
	// The draft as last saved or opened; anything else is an unsaved change.
	const savedFormRef = useRef(form);
	const workspaceRevision = useRef(0);
	const modelRevision = useRef(0);
	const savedTimeoutRef = useRef<number | undefined>(undefined);
	const enabledChangeRef = useRef<Promise<void> | null>(null);
	// Mirror edits immediately so late default lookups cannot replace user input.
	const setForm = useCallback<Dispatch<SetStateAction<ScheduleFormState>>>(
		(update) => {
			window.clearTimeout(savedTimeoutRef.current);
			setIsSaved(false);
			const previous = formRef.current;
			const next = typeof update === "function" ? update(previous) : update;
			if (next.workspaceRoot !== previous.workspaceRoot)
				workspaceRevision.current += 1;
			if (next.provider !== previous.provider || next.model !== previous.model)
				modelRevision.current += 1;
			formRef.current = next;
			setFormState(next);
			// Editing the flagged field answers its message.
			setValidation((issue) =>
				issue &&
				SCHEDULE_FIELD_FORM_KEYS[issue.field].some(
					(key) => next[key] !== previous[key],
				)
					? null
					: issue,
			);
		},
		[],
	);
	/** Replace the draft and treat the result as the saved baseline. */
	const resetForm = useCallback(
		(next: ScheduleFormState) => {
			setForm(next);
			savedFormRef.current = formRef.current;
		},
		[setForm],
	);
	/** Apply a looked-up default without it counting as the reader's edit. */
	const applyDefaults = useCallback(
		(defaults: Partial<ScheduleFormState>) => {
			savedFormRef.current = { ...savedFormRef.current, ...defaults };
			setForm((current) => ({ ...current, ...defaults }));
		},
		[setForm],
	);
	const syncEnabled = useCallback(
		(enabled: boolean) => {
			// Enabled is saved immediately, independently of the editable draft.
			savedFormRef.current = { ...savedFormRef.current, enabled };
			if (formRef.current.enabled !== enabled) {
				setForm((current) => ({ ...current, enabled }));
			}
			setEditingSchedule((current) =>
				current ? { ...current, enabled } : current,
			);
		},
		[setForm],
	);
	const editingScheduleId = editingSchedule?.scheduleId;
	const persistedSchedule = schedules.find(
		(schedule) => schedule.scheduleId === editingScheduleId,
	);
	const persistedEnabled = persistedSchedule?.enabled;
	useEffect(() => {
		if (!editingScheduleId || persistedEnabled === undefined) return;
		// Overview refreshes may reflect a pause or resume from another window.
		// Update only this setting so the rest of the draft stays intact.
		syncEnabled(persistedEnabled);
	}, [editingScheduleId, persistedEnabled, syncEnabled]);
	useEffect(
		() => () => {
			// Whatever is still in flight belongs to an editor that has gone.
			editorSequence.current += 1;
			window.clearTimeout(savedTimeoutRef.current);
		},
		[],
	);
	/** Close immediately, abandoning the draft. */
	const dismissEditor = () => {
		editorSequence.current += 1;
		openRef.current = false;
		setIsOpen(false);
		setEditingSchedule(null);
		setRequestError(null);
		setValidation(null);
		window.clearTimeout(savedTimeoutRef.current);
		setIsSaved(false);
	};
	/** Whether leaving now would lose edits; reads live state, not the last render. */
	const hasUnsavedChangesNow = useCallback(
		() => openRef.current && !isSameForm(formRef.current, savedFormRef.current),
		[],
	);
	const openCreate = async (template?: ScheduleTemplate) => {
		if (savingRef.current || !mountedRef.current) return;
		const requestId = ++editorSequence.current;
		setEditingSchedule(null);
		clearActionError();
		setRequestError(null);
		setValidation(null);
		const remembered = readRememberedChoices();
		resetForm(newScheduleForm(template, remembered));
		openRef.current = true;
		setIsOpen(true);
		// A slower lookup only fills a field the reader has not touched since.
		const workspaceAtOpen = workspaceRevision.current;
		const modelAtOpen = modelRevision.current;
		const isCurrentEditor = () =>
			mountedRef.current &&
			openRef.current &&
			requestId === editorSequence.current;
		const fillProjectFolder = async () => {
			if (remembered.projectFolder) return;
			const workspaceRoot = await lookUpProjectFolder();
			if (
				workspaceRoot !== undefined &&
				isCurrentEditor() &&
				workspaceAtOpen === workspaceRevision.current
			)
				applyDefaults({ workspaceRoot });
		};
		const fillModelSelection = async () => {
			const selection = await lookUpModelSelection(remembered.modelSelection);
			if (
				selection &&
				isCurrentEditor() &&
				modelAtOpen === modelRevision.current
			)
				applyDefaults(selection);
		};
		await Promise.all([fillProjectFolder(), fillModelSelection()]);
	};

	const openEdit = (schedule: Schedule) => {
		if (savingRef.current || !mountedRef.current) return;
		editorSequence.current += 1;
		setEditingSchedule(schedule);
		clearActionError();
		setRequestError(null);
		setValidation(null);
		resetForm(formFromSchedule(schedule));
		openRef.current = true;
		setIsOpen(true);
	};

	const savedForm = savedFormRef.current;
	const hasUnsavedChanges = !isSameForm(form, savedForm);
	const hasUnsavedTimingChanges = !hasSameTiming(form, savedForm);

	const changeEnabled = async (enabled: boolean) => {
		if (
			!editingSchedule ||
			savingRef.current ||
			enabledChangeRef.current ||
			!openRef.current ||
			!mountedRef.current
		)
			return;
		const requestId = editorSequence.current;
		setIsChangingEnabled(true);
		const change = (async () => {
			try {
				const updated = await setScheduleEnabled(editingSchedule, enabled);
				if (
					updated &&
					mountedRef.current &&
					requestId === editorSequence.current
				)
					syncEnabled(enabled);
			} finally {
				enabledChangeRef.current = null;
				if (mountedRef.current) setIsChangingEnabled(false);
			}
		})();
		enabledChangeRef.current = change;
		await change;
	};
	/** Saving and running read the persisted switch, so let a toggle land first. */
	const whenEnabledSettled = async () => {
		await enabledChangeRef.current;
	};

	const save = async (): Promise<boolean> => {
		if (savingRef.current || !openRef.current || !mountedRef.current)
			return false;
		window.clearTimeout(savedTimeoutRef.current);
		setIsSaved(false);
		const requestId = editorSequence.current;
		const issue = validateScheduleForm(formRef.current);
		if (issue) {
			setRequestError(null);
			// A fresh object each attempt lets the page return focus to the field.
			setValidation({ ...issue });
			return false;
		}
		setRequestError(null);
		setValidation(null);
		// A pending initial-default lookup must not change a submitted draft,
		// including after the request fails and the editor becomes editable again.
		modelRevision.current += 1;
		savingRef.current = true;
		setIsSaving(true);
		try {
			await whenEnabledSettled();
			if (!mountedRef.current || requestId !== editorSequence.current)
				return false;
			const form = formRef.current;
			const response = await desktopClient.invoke<{
				schedule?: Schedule | null;
			}>(
				editingSchedule ? "update_routine_schedule" : "create_routine_schedule",
				buildSchedulePayload(form, editingSchedule),
			);
			if (!mountedRef.current || requestId !== editorSequence.current)
				return false;
			savedFormRef.current = form;
			if (response?.schedule) setEditingSchedule(response.schedule);
			await refreshSchedules({ showLoading: false });
			if (!mountedRef.current || requestId !== editorSequence.current)
				return false;
			setIsSaved(true);
			savedTimeoutRef.current = window.setTimeout(
				() => setIsSaved(false),
				SAVED_CONFIRMATION_MS,
			);
			return true;
		} catch (error) {
			if (mountedRef.current && requestId === editorSequence.current) {
				setRequestError(error instanceof Error ? error.message : String(error));
			}
			return false;
		} finally {
			savingRef.current = false;
			if (mountedRef.current) setIsSaving(false);
		}
	};

	return {
		isOpen,
		dismissEditor,
		editingSchedule,
		/** The latest overview record for the schedule being edited. */
		persistedSchedule: persistedSchedule ?? editingSchedule,
		isSaving,
		isSaved,
		isChangingEnabled,
		whenEnabledSettled,
		hasUnsavedChanges,
		hasUnsavedChangesNow,
		hasUnsavedTimingChanges,
		error: validation?.message ?? requestError,
		validation,
		form,
		setForm,
		changeEnabled,
		openCreate,
		openEdit,
		save,
	};
}

export type ScheduleEditor = ReturnType<typeof useScheduleEditor>;
