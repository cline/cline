"use client";

import {
	CLINE_DEFAULT_MODEL_ID,
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
} from "@cline/shared";
import {
	Circle,
	Eye,
	Pause,
	Pencil,
	Play,
	Plus,
	RefreshCw,
	Trash2,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";
import { readModelSelectionStorageFromWindow } from "@/lib/model-selection";
import { normalizeProviderId } from "@/lib/provider-id";
import {
	loadProviderModelCatalog,
	loadProviderModels,
} from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";
import {
	CommandBadge,
	PageEmptyState,
	PageFrame,
	PageHeader,
} from "../page-layout";

type DateTimeValue = number | string;

interface RoutineSchedule {
	scheduleId: string;
	name: string;
	cronPattern: string;
	metadata?: Record<string, unknown>;
	prompt: string;
	provider?: string;
	model?: string;
	modelSelection?: {
		providerId?: string;
		modelId?: string;
	};
	mode: "act" | "plan" | "yolo";
	workspaceRoot?: string;
	cwd?: string;
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	maxParallel: number;
	enabled: boolean;
	createdAt: DateTimeValue;
	updatedAt: DateTimeValue;
	lastRunAt?: DateTimeValue;
	nextRunAt?: DateTimeValue;
	tags?: string[];
}

interface RoutineExecution {
	executionId: string;
	scheduleId: string;
	sessionId?: string;
	triggeredAt?: DateTimeValue;
	startedAt?: DateTimeValue;
	endedAt?: DateTimeValue;
	timeoutAt?: DateTimeValue;
	status?: string;
	errorMessage?: string;
}

interface RoutineUpcomingRun {
	scheduleId: string;
	name: string;
	nextRunAt: DateTimeValue;
}

interface RoutineOverviewResponse {
	schedules: RoutineSchedule[];
	activeExecutions: RoutineExecution[];
	upcomingRuns: RoutineUpcomingRun[];
	lastExecutions: RoutineExecution[];
}

const ROUTINE_OVERVIEW_CACHE_TTL_MS = 30_000;

let routineOverviewCache:
	| (RoutineOverviewResponse & {
			fetchedAt: number;
	  })
	| null = null;

async function fetchRoutineOverview(): Promise<RoutineOverviewResponse> {
	const response = await desktopClient.invoke<RoutineOverviewResponse>(
		"list_routine_schedules",
	);
	return {
		schedules: response.schedules ?? [],
		activeExecutions: response.activeExecutions ?? [],
		upcomingRuns: response.upcomingRuns ?? [],
		lastExecutions: response.lastExecutions ?? [],
	};
}

interface ProcessContext {
	workspaceRoot: string;
	cwd: string;
}

const FALLBACK_PROVIDER_MODELS: Record<string, string[]> = {
	cline: [CLINE_DEFAULT_MODEL_ID],
	anthropic: ["claude-sonnet-4-6"],
	"openai-native": ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

const WEEKDAY_OPTIONS = [
	{ label: "Mon", value: "MON" },
	{ label: "Tue", value: "TUE" },
	{ label: "Wed", value: "WED" },
	{ label: "Thu", value: "THU" },
	{ label: "Fri", value: "FRI" },
	{ label: "Sat", value: "SAT" },
	{ label: "Sun", value: "SUN" },
] as const;

interface RoutineFormState {
	name: string;
	scheduleHour: string;
	scheduleMinute: string;
	scheduleDays: string[];
	prompt: string;
	provider: string;
	model: string;
	workspaceRoot: string;
	systemPrompt: string;
	timeoutSeconds: string;
	tags: string;
	enabled: boolean;
}

function formatDateTime(value?: DateTimeValue | null): string {
	if (value === undefined || value === null) {
		return "-";
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			return "-";
		}
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return "-";
	}
	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) {
		return trimmed;
	}
	return parsed.toLocaleString();
}

function getOneTimeScheduleRunAt(
	schedule: RoutineSchedule,
): number | undefined {
	const runAt = schedule.metadata?.[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY];
	return typeof runAt === "number" && Number.isFinite(runAt)
		? runAt
		: undefined;
}

function formatScheduleModel(schedule: RoutineSchedule): string {
	const provider =
		schedule.modelSelection?.providerId?.trim() || schedule.provider?.trim();
	const model =
		schedule.modelSelection?.modelId?.trim() || schedule.model?.trim();
	if (provider && model) {
		return `${provider}/${model}`;
	}
	return model || provider || "-";
}

function getScheduleProviderModel(schedule: RoutineSchedule): {
	provider: string;
	model: string;
} {
	return {
		provider:
			schedule.modelSelection?.providerId?.trim() ||
			schedule.provider?.trim() ||
			"cline",
		model:
			schedule.modelSelection?.modelId?.trim() ||
			schedule.model?.trim() ||
			CLINE_DEFAULT_MODEL_ID,
	};
}

function formatExecutionResult(execution?: RoutineExecution): string {
	if (!execution) {
		return "-";
	}
	const status = execution.status?.trim() || "unknown";
	const timestamp =
		execution.endedAt ?? execution.startedAt ?? execution.triggeredAt;
	const when = formatDateTime(timestamp);
	return when === "-" ? status : `${status} at ${when}`;
}

function asTrimmedFormString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
	const trimmed = asTrimmedFormString(value);
	if (!trimmed) {
		return undefined;
	}
	const parsedValue = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
		return undefined;
	}
	return parsedValue;
}

function parseTags(value: unknown): string[] | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const tags = value
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	return tags.length > 0 ? tags : undefined;
}

function normalizeScheduleDays(days: string[]): string[] {
	const selected = new Set(days);
	return WEEKDAY_OPTIONS.map((option) => option.value).filter((value) =>
		selected.has(value),
	);
}

function buildCronPattern(
	days: string[],
	hour: string,
	minute: string,
): string {
	const normalizedDays = normalizeScheduleDays(days);
	if (normalizedDays.length === 0) {
		return "";
	}
	const normalizedHour = Number.parseInt(hour, 10);
	const normalizedMinute = Number.parseInt(minute, 10);
	const cronHour = Number.isFinite(normalizedHour)
		? Math.min(Math.max(normalizedHour, 0), 23)
		: 9;
	const cronMinute = Number.isFinite(normalizedMinute)
		? Math.min(Math.max(normalizedMinute, 0), 59)
		: 0;
	if (normalizedDays.length === WEEKDAY_OPTIONS.length) {
		return `${cronMinute} ${cronHour} * * *`;
	}
	return `${cronMinute} ${cronHour} * * ${normalizedDays.join(",")}`;
}

function expandCronDays(dayExpression: string | undefined): string[] {
	const raw = dayExpression?.trim().toUpperCase();
	if (!raw || raw === "*") {
		return WEEKDAY_OPTIONS.map((option) => option.value);
	}
	const values = new Set<string>();
	for (const part of raw.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const rangeMatch = /^([A-Z]{3})-([A-Z]{3})$/.exec(trimmed);
		if (rangeMatch) {
			const start = WEEKDAY_OPTIONS.findIndex(
				(option) => option.value === rangeMatch[1],
			);
			const end = WEEKDAY_OPTIONS.findIndex(
				(option) => option.value === rangeMatch[2],
			);
			if (start >= 0 && end >= start) {
				for (let index = start; index <= end; index += 1) {
					values.add(WEEKDAY_OPTIONS[index].value);
				}
			}
			continue;
		}
		if (WEEKDAY_OPTIONS.some((option) => option.value === trimmed)) {
			values.add(trimmed);
		}
	}
	return normalizeScheduleDays([...values]);
}

function parseCronPattern(
	cronPattern: string,
): Pick<RoutineFormState, "scheduleHour" | "scheduleMinute" | "scheduleDays"> {
	const parts = cronPattern.trim().split(/\s+/);
	const minute = Number.parseInt(parts[0] ?? "", 10);
	const hour = Number.parseInt(parts[1] ?? "", 10);
	const days = expandCronDays(parts[4]);
	return {
		scheduleHour:
			Number.isInteger(hour) && hour >= 0 && hour <= 23 ? String(hour) : "9",
		scheduleMinute:
			Number.isInteger(minute) && minute >= 0 && minute <= 59
				? String(minute)
				: "0",
		scheduleDays: days.length > 0 ? days : ["MON", "TUE", "WED", "THU", "FRI"],
	};
}

export function RoutineSchedulesContent() {
	const [schedules, setSchedules] = useState<RoutineSchedule[]>(
		() => routineOverviewCache?.schedules ?? [],
	);
	const [activeExecutions, setActiveExecutions] = useState<RoutineExecution[]>(
		() => routineOverviewCache?.activeExecutions ?? [],
	);
	const [upcomingRuns, setUpcomingRuns] = useState<RoutineUpcomingRun[]>(
		() => routineOverviewCache?.upcomingRuns ?? [],
	);
	const [lastExecutions, setLastExecutions] = useState<RoutineExecution[]>(
		() => routineOverviewCache?.lastExecutions ?? [],
	);
	const [isLoading, setIsLoading] = useState(() => !routineOverviewCache);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [busyScheduleId, setBusyScheduleId] = useState<string | null>(null);
	const [schedulePendingDelete, setSchedulePendingDelete] =
		useState<RoutineSchedule | null>(null);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [editingSchedule, setEditingSchedule] =
		useState<RoutineSchedule | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [createFormError, setCreateFormError] = useState<string | null>(null);
	const [providerModels, setProviderModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_MODELS);
	const [enabledProviderIds, setEnabledProviderIds] = useState<string[]>(() =>
		Object.keys(FALLBACK_PROVIDER_MODELS),
	);
	const [lastModelSelection] = useState(() =>
		readModelSelectionStorageFromWindow(),
	);
	const rememberedProvider = normalizeProviderId(
		lastModelSelection.lastProvider,
	);
	const [createForm, setCreateForm] = useState<RoutineFormState>({
		name: "",
		scheduleHour: "9",
		scheduleMinute: "0",
		scheduleDays: ["MON", "TUE", "WED", "THU", "FRI"],
		prompt: "Review PRs opened yesterday and summarize issues.",
		provider: "cline",
		model: CLINE_DEFAULT_MODEL_ID,
		workspaceRoot: "",
		systemPrompt: "",
		timeoutSeconds: "",
		tags: "",
		enabled: true,
	});

	const visibleProviderModels = useMemo(() => {
		if (enabledProviderIds.length === 0) {
			return providerModels;
		}
		const next: Record<string, string[]> = {};
		for (const providerId of enabledProviderIds) {
			next[providerId] = providerModels[providerId] ?? [];
		}
		return next;
	}, [enabledProviderIds, providerModels]);

	const availableProviders = useMemo(
		() => Object.keys(visibleProviderModels),
		[visibleProviderModels],
	);

	const availableModelsForProvider = useMemo(
		() => visibleProviderModels[createForm.provider] ?? [],
		[createForm.provider, visibleProviderModels],
	);

	const cronPreview = useMemo(
		() =>
			buildCronPattern(
				createForm.scheduleDays,
				createForm.scheduleHour,
				createForm.scheduleMinute,
			),
		[
			createForm.scheduleDays,
			createForm.scheduleHour,
			createForm.scheduleMinute,
		],
	);

	useEffect(() => {
		let cancelled = false;

		async function loadCatalog() {
			try {
				const payload = await loadProviderModelCatalog();
				if (cancelled) {
					return;
				}
				setProviderModels(payload.providerModels);
				setEnabledProviderIds((current) => {
					const nextProviderIds = new Set(payload.enabledProviderIds);
					const normalizedCurrentProvider = normalizeProviderId(
						createForm.provider,
					);
					if (normalizedCurrentProvider) {
						nextProviderIds.add(normalizedCurrentProvider);
					}
					for (const providerId of current) {
						if (providerId in payload.providerModels) {
							nextProviderIds.add(providerId);
						}
					}
					return Array.from(nextProviderIds);
				});
			} catch {
				// Keep fallback values if provider catalog is unavailable.
			}
		}

		void loadCatalog();
		return () => {
			cancelled = true;
		};
	}, [createForm.provider]);

	useEffect(() => {
		const normalizedProvider = normalizeProviderId(createForm.provider);
		if (!normalizedProvider) {
			return;
		}
		if ((providerModels[normalizedProvider] ?? []).length > 0) {
			return;
		}

		let cancelled = false;

		async function loadModelsForProvider() {
			try {
				const models = await loadProviderModels(normalizedProvider);
				if (cancelled || models.length === 0) {
					return;
				}
				setProviderModels((current) => ({
					...current,
					[normalizedProvider]: models.map((entry) => entry.id),
				}));
				setEnabledProviderIds((current) =>
					current.includes(normalizedProvider)
						? current
						: [...current, normalizedProvider],
				);
			} catch {
				// Keep existing values when provider-specific model loading fails.
			}
		}

		void loadModelsForProvider();
		return () => {
			cancelled = true;
		};
	}, [createForm.provider, providerModels]);

	useEffect(() => {
		if (availableProviders.length === 0) {
			return;
		}
		let nextSelection: { provider: string; model: string } | null = null;
		const normalizedFormProvider = normalizeProviderId(createForm.provider);
		if (!availableProviders.includes(normalizedFormProvider)) {
			const nextProvider =
				rememberedProvider && availableProviders.includes(rememberedProvider)
					? rememberedProvider
					: availableProviders[0];
			const models = visibleProviderModels[nextProvider] ?? [];
			const rememberedModel =
				lastModelSelection.lastModelByProvider[nextProvider] ??
				lastModelSelection.lastModelByProvider[lastModelSelection.lastProvider];
			const nextModel =
				rememberedModel && models.includes(rememberedModel)
					? rememberedModel
					: (models[0] ?? "");
			nextSelection = { provider: nextProvider, model: nextModel };
		} else {
			const models = visibleProviderModels[normalizedFormProvider] ?? [];
			if (models.length === 0 || models.includes(createForm.model)) {
				return;
			}
			const rememberedModel =
				lastModelSelection.lastModelByProvider[normalizedFormProvider] ??
				lastModelSelection.lastModelByProvider[lastModelSelection.lastProvider];
			const nextModel =
				rememberedModel && models.includes(rememberedModel)
					? rememberedModel
					: models[0];
			nextSelection = { provider: normalizedFormProvider, model: nextModel };
		}

		const timeoutId = window.setTimeout(() => {
			setCreateForm((prev) => ({
				...prev,
				...nextSelection,
			}));
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [
		availableProviders,
		createForm.model,
		createForm.provider,
		lastModelSelection.lastModelByProvider,
		lastModelSelection.lastProvider,
		rememberedProvider,
		visibleProviderModels,
	]);

	const refreshSchedules = useCallback(
		async (options?: { force?: boolean; showLoading?: boolean }) => {
			const now = Date.now();
			if (
				!options?.force &&
				routineOverviewCache &&
				now - routineOverviewCache.fetchedAt < ROUTINE_OVERVIEW_CACHE_TTL_MS
			) {
				setSchedules(routineOverviewCache.schedules);
				setActiveExecutions(routineOverviewCache.activeExecutions);
				setUpcomingRuns(routineOverviewCache.upcomingRuns);
				setLastExecutions(routineOverviewCache.lastExecutions);
				setErrorMessage(null);
				setIsLoading(false);
				return;
			}

			if (options?.showLoading !== false) {
				setIsLoading(true);
			}
			setErrorMessage(null);
			try {
				const response = await fetchRoutineOverview();
				const schedules = response.schedules;
				const activeExecutions = response.activeExecutions;
				const upcomingRuns = response.upcomingRuns;
				const lastExecutions = response.lastExecutions;
				setSchedules(schedules);
				setActiveExecutions(activeExecutions);
				setUpcomingRuns(upcomingRuns);
				setLastExecutions(lastExecutions);
				routineOverviewCache = {
					schedules,
					activeExecutions,
					upcomingRuns,
					lastExecutions,
					fetchedAt: now,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setErrorMessage(message);
			} finally {
				setIsLoading(false);
			}
		},
		[],
	);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void refreshSchedules();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [refreshSchedules]);

	const upsertScheduleEnabled = async (
		schedule: RoutineSchedule,
		enabled: boolean,
	) => {
		setBusyScheduleId(schedule.scheduleId);
		setErrorMessage(null);
		try {
			if (enabled) {
				await desktopClient.invoke("resume_routine_schedule", {
					schedule_id: schedule.scheduleId,
				});
			} else {
				await desktopClient.invoke("pause_routine_schedule", {
					schedule_id: schedule.scheduleId,
				});
			}
			await refreshSchedules({ force: true, showLoading: false });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyScheduleId(null);
		}
	};

	const triggerSchedule = async (scheduleId: string) => {
		setBusyScheduleId(scheduleId);
		setErrorMessage(null);
		try {
			await desktopClient.invoke("trigger_routine_schedule", {
				schedule_id: scheduleId,
			});
			await refreshSchedules({ force: true, showLoading: false });
			window.setTimeout(() => {
				void refreshSchedules({ force: true, showLoading: false });
			}, 1_000);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyScheduleId(null);
		}
	};

	const deleteSchedule = async (scheduleId: string) => {
		setBusyScheduleId(scheduleId);
		setErrorMessage(null);
		try {
			await desktopClient.invoke("delete_routine_schedule", {
				schedule_id: scheduleId,
			});
			setSchedulePendingDelete(null);
			await refreshSchedules({ force: true, showLoading: false });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyScheduleId(null);
		}
	};

	const openCreateDialog = async () => {
		setEditingSchedule(null);
		setErrorMessage(null);
		setCreateFormError(null);
		let context: ProcessContext = { workspaceRoot: "", cwd: "" };
		try {
			context = await desktopClient.invoke<ProcessContext>(
				"get_process_context",
			);
		} catch {
			// Use empty defaults when context lookup fails.
		}
		const preferredProvider =
			rememberedProvider && availableProviders.includes(rememberedProvider)
				? rememberedProvider
				: (availableProviders[0] ?? "cline");
		const modelsForProvider = visibleProviderModels[preferredProvider] ?? [];
		const rememberedModel =
			lastModelSelection.lastModelByProvider[preferredProvider] ??
			lastModelSelection.lastModelByProvider[lastModelSelection.lastProvider];
		const preferredModel =
			rememberedModel && modelsForProvider.includes(rememberedModel)
				? rememberedModel
				: (modelsForProvider[0] ?? createForm.model);
		setCreateForm({
			name: "",
			scheduleHour: "9",
			scheduleMinute: "0",
			scheduleDays: ["MON", "TUE", "WED", "THU", "FRI"],
			prompt: "Review PRs opened yesterday and summarize issues.",
			provider: preferredProvider,
			model: preferredModel,
			workspaceRoot: context.workspaceRoot || context.cwd,
			systemPrompt: "",
			timeoutSeconds: "",
			tags: "",
			enabled: true,
		});
		setIsCreateOpen(true);
	};

	const openEditDialog = (schedule: RoutineSchedule) => {
		if (schedule.cronPattern === ONE_TIME_SCHEDULE_CRON_PATTERN) {
			return;
		}
		const { provider, model } = getScheduleProviderModel(schedule);
		const parsedCron = parseCronPattern(schedule.cronPattern);
		setEditingSchedule(schedule);
		setErrorMessage(null);
		setCreateFormError(null);
		setEnabledProviderIds((current) =>
			current.includes(provider) ? current : [...current, provider],
		);
		setProviderModels((current) =>
			current[provider]?.includes(model)
				? current
				: {
						...current,
						[provider]: [...(current[provider] ?? []), model],
					},
		);
		setCreateForm({
			name: schedule.name,
			...parsedCron,
			prompt: schedule.prompt,
			provider,
			model,
			workspaceRoot: schedule.workspaceRoot ?? "",
			systemPrompt: schedule.systemPrompt ?? "",
			timeoutSeconds:
				typeof schedule.timeoutSeconds === "number"
					? String(schedule.timeoutSeconds)
					: "",
			tags: schedule.tags?.join(",") ?? "",
			enabled: schedule.enabled,
		});
		setIsCreateOpen(true);
	};

	const submitCreateForm = async () => {
		const name = asTrimmedFormString(createForm.name);
		if (!name) {
			setCreateFormError("Routine name is required.");
			return;
		}
		const cronPattern = buildCronPattern(
			createForm.scheduleDays,
			createForm.scheduleHour,
			createForm.scheduleMinute,
		);
		if (!cronPattern) {
			setCreateFormError("Select at least one day and a valid time.");
			return;
		}
		const prompt = asTrimmedFormString(createForm.prompt);
		if (!prompt) {
			setCreateFormError("Prompt is required.");
			return;
		}
		const workspaceRoot = asTrimmedFormString(createForm.workspaceRoot);
		if (!workspaceRoot) {
			setCreateFormError("Workspace root is required.");
			return;
		}
		setCreateFormError(null);
		setIsCreating(true);
		try {
			const provider =
				normalizeProviderId(asTrimmedFormString(createForm.provider)) ||
				availableProviders[0] ||
				"cline";
			const model =
				asTrimmedFormString(createForm.model) ||
				(visibleProviderModels[provider] ?? [])[0] ||
				CLINE_DEFAULT_MODEL_ID;
			const systemPrompt = asTrimmedFormString(createForm.systemPrompt);
			const timeoutSeconds = parseOptionalPositiveInt(
				createForm.timeoutSeconds,
			);
			const tags = parseTags(createForm.tags);
			const command = editingSchedule
				? "update_routine_schedule"
				: "create_routine_schedule";
			await desktopClient.invoke(command, {
				...(editingSchedule
					? { schedule_id: editingSchedule.scheduleId }
					: undefined),
				name,
				cron_pattern: cronPattern,
				prompt,
				provider,
				model,
				mode: editingSchedule?.mode ?? "yolo", // New routines must default to yolo mode.
				workspace_root: workspaceRoot,
				cwd: editingSchedule ? (editingSchedule.cwd ?? null) : workspaceRoot,
				system_prompt: editingSchedule
					? systemPrompt || null
					: systemPrompt || undefined,
				timeout_seconds: editingSchedule
					? (timeoutSeconds ?? null)
					: timeoutSeconds,
				max_parallel: 1,
				enabled: createForm.enabled,
				tags: tags ?? [],
			});
			await refreshSchedules({ force: true, showLoading: false });
			setIsCreateOpen(false);
			setEditingSchedule(null);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setCreateFormError(message);
		} finally {
			setIsCreating(false);
		}
	};

	const executionBySchedule = useMemo(() => {
		const map = new Map<string, RoutineExecution>();
		for (const execution of activeExecutions) {
			if (!execution.scheduleId) {
				continue;
			}
			if (!map.has(execution.scheduleId)) {
				map.set(execution.scheduleId, execution);
			}
		}
		return map;
	}, [activeExecutions]);

	const lastExecutionBySchedule = useMemo(() => {
		const map = new Map<string, RoutineExecution>();
		for (const execution of lastExecutions) {
			if (!execution.scheduleId) {
				continue;
			}
			if (!map.has(execution.scheduleId)) {
				map.set(execution.scheduleId, execution);
			}
		}
		return map;
	}, [lastExecutions]);

	const sortedSchedules = useMemo(
		() =>
			[...schedules].sort((a, b) =>
				a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
			),
		[schedules],
	);

	return (
		<PageFrame>
			<PageHeader
				description="Scheduled jobs are run through the hub."
				title="Schedules"
				meta={<CommandBadge>cline schedule</CommandBadge>}
				actions={
					<>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void refreshSchedules()}
							disabled={isLoading}
						>
							<RefreshCw
								className={cn("h-4 w-4", isLoading && "animate-spin")}
							/>
						</Button>
						<Button size="sm" onClick={() => void openCreateDialog()}>
							<Plus className="h-4 w-4" />
							New Schedule
						</Button>
					</>
				}
			/>

			{errorMessage && (
				<div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{errorMessage}
				</div>
			)}

			{isLoading ? (
				<PageEmptyState>Loading schedules...</PageEmptyState>
			) : sortedSchedules.length === 0 ? (
				<PageEmptyState>
					No schedules found. Create a schedule to run routines on a recurring
					basis.
				</PageEmptyState>
			) : (
				<div className="flex flex-col gap-3">
					{sortedSchedules.map((schedule) => {
						const isBusy = busyScheduleId === schedule.scheduleId;
						const activeExecution = executionBySchedule.get(
							schedule.scheduleId,
						);
						const lastExecution = lastExecutionBySchedule.get(
							schedule.scheduleId,
						);
						const upcoming = upcomingRuns.find(
							(item) => item.scheduleId === schedule.scheduleId,
						);
						return (
							<div
								key={schedule.scheduleId}
								className="rounded-lg border border-border px-5 py-4 transition-colors hover:bg-accent/20"
							>
								<div className="flex items-center gap-3">
									<Circle
										className={cn(
											"h-2.5 w-2.5 shrink-0",
											schedule.enabled
												? "fill-primary text-primary"
												: "fill-muted-foreground/40 text-muted-foreground/40",
										)}
									/>
									<h3 className="text-sm font-semibold text-foreground">
										{schedule.name}
									</h3>
									<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
										{schedule.mode}
									</span>
									<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
										{schedule.cronPattern === ONE_TIME_SCHEDULE_CRON_PATTERN
											? `Once · ${formatDateTime(getOneTimeScheduleRunAt(schedule))}`
											: schedule.cronPattern}
									</span>
									<div className="flex-1" />
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`View ${schedule.name}`}
											onClick={() => {
												window.alert(JSON.stringify(schedule, null, 2));
											}}
										>
											<Eye className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Edit ${schedule.name}`}
											onClick={() => openEditDialog(schedule)}
											disabled={
												isBusy ||
												schedule.cronPattern === ONE_TIME_SCHEDULE_CRON_PATTERN
											}
										>
											<Pencil className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Run ${schedule.name} now`}
											onClick={() => void triggerSchedule(schedule.scheduleId)}
											disabled={isBusy}
										>
											<Zap className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={
												schedule.enabled
													? `Pause ${schedule.name}`
													: `Resume ${schedule.name}`
											}
											onClick={() =>
												void upsertScheduleEnabled(schedule, !schedule.enabled)
											}
											disabled={isBusy}
										>
											{schedule.enabled ? (
												<Pause className="h-3.5 w-3.5" />
											) : (
												<Play className="h-3.5 w-3.5" />
											)}
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Delete ${schedule.name}`}
											onClick={() => setSchedulePendingDelete(schedule)}
											disabled={isBusy}
										>
											<Trash2 className="h-3.5 w-3.5" />
										</Button>
										<Switch
											checked={schedule.enabled}
											onCheckedChange={(checked) =>
												void upsertScheduleEnabled(schedule, checked)
											}
											disabled={isBusy}
											aria-label={`Enable ${schedule.name}`}
										/>
									</div>
								</div>

								<div className="mt-2.5 ml-5.5 flex flex-col gap-1 text-xs text-muted-foreground">
									<p>
										<span className="text-muted-foreground/70">ID:</span>{" "}
										{schedule.scheduleId}
									</p>
									<p>
										<span className="text-muted-foreground/70">Prompt:</span>{" "}
										{schedule.prompt}
									</p>
									<p>
										<span className="text-muted-foreground/70">Model:</span>{" "}
										{formatScheduleModel(schedule)}
									</p>
									{schedule.workspaceRoot && (
										<p>
											<span className="text-muted-foreground/70">
												Workspace:
											</span>{" "}
											{schedule.workspaceRoot}
										</p>
									)}
									{schedule.cwd && (
										<p>
											<span className="text-muted-foreground/70">CWD:</span>{" "}
											{schedule.cwd}
										</p>
									)}
									<p>
										<span className="text-muted-foreground/70">Last run:</span>{" "}
										{formatDateTime(schedule.lastRunAt)}
									</p>
									<p>
										<span className="text-muted-foreground/70">
											Last result:
										</span>{" "}
										{formatExecutionResult(lastExecution)}
									</p>
									{lastExecution?.sessionId && (
										<p>
											<span className="text-muted-foreground/70">
												Last session:
											</span>{" "}
											{lastExecution.sessionId}
										</p>
									)}
									{lastExecution?.errorMessage && (
										<p className="text-destructive">
											<span className="text-muted-foreground/70">
												Last error:
											</span>{" "}
											{lastExecution.errorMessage}
										</p>
									)}
									<p>
										<span className="text-muted-foreground/70">Next run:</span>{" "}
										{formatDateTime(schedule.nextRunAt || upcoming?.nextRunAt)}
									</p>
									{activeExecution && (
										<p>
											<span className="text-muted-foreground/70">Active:</span>{" "}
											{activeExecution.executionId} since{" "}
											{formatDateTime(activeExecution.startedAt)}
										</p>
									)}
									{schedule.tags && schedule.tags.length > 0 && (
										<p>
											<span className="text-muted-foreground/70">Tags:</span>{" "}
											{schedule.tags.join(", ")}
										</p>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
			<AlertDialog
				open={Boolean(schedulePendingDelete)}
				onOpenChange={(open) => {
					if (!open) {
						setSchedulePendingDelete(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Routine</AlertDialogTitle>
						<AlertDialogDescription>
							This will delete "{schedulePendingDelete?.name ?? "this routine"}"
							and remove future scheduled runs.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={
								schedulePendingDelete
									? busyScheduleId === schedulePendingDelete.scheduleId
									: false
							}
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								!schedulePendingDelete ||
								busyScheduleId === schedulePendingDelete.scheduleId
							}
							onClick={() => {
								if (schedulePendingDelete) {
									void deleteSchedule(schedulePendingDelete.scheduleId);
								}
							}}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<Dialog
				open={isCreateOpen}
				onOpenChange={(open) => {
					setIsCreateOpen(open);
					if (!open) {
						setCreateFormError(null);
						setEditingSchedule(null);
					}
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{editingSchedule ? "Edit Routine" : "Create Routine"}
						</DialogTitle>
						<DialogDescription>
							{editingSchedule
								? "Update this scheduler routine."
								: "Create a scheduler routine."}
						</DialogDescription>
					</DialogHeader>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="sm:col-span-2">
							<Label htmlFor="routine-name">Name</Label>
							<Input
								id="routine-name"
								value={createForm.name}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										name: event.target.value,
									}))
								}
								placeholder="Daily code review"
							/>
						</div>

						<div className="sm:col-span-2 space-y-3">
							<Label>Schedule</Label>
							<div className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
								<div>
									<Label htmlFor="routine-hour">Hour</Label>
									<Select
										value={createForm.scheduleHour}
										onValueChange={(value) =>
											setCreateForm((prev) => ({
												...prev,
												scheduleHour: value ?? prev.scheduleHour,
											}))
										}
									>
										<SelectTrigger className="w-full" id="routine-hour">
											<SelectValue placeholder="Hour" />
										</SelectTrigger>
										<SelectContent>
											{Array.from({ length: 24 }, (_, idx) => idx).map(
												(hour) => (
													<SelectItem key={`hour-${hour}`} value={`${hour}`}>
														{hour.toString().padStart(2, "0")}
													</SelectItem>
												),
											)}
										</SelectContent>
									</Select>
								</div>
								<div>
									<Label htmlFor="routine-minute">Minute</Label>
									<Select
										value={createForm.scheduleMinute}
										onValueChange={(value) =>
											setCreateForm((prev) => ({
												...prev,
												scheduleMinute: value ?? prev.scheduleMinute,
											}))
										}
									>
										<SelectTrigger className="w-full" id="routine-minute">
											<SelectValue placeholder="Minute" />
										</SelectTrigger>
										<SelectContent>
											{Array.from({ length: 60 }, (_, minute) => minute).map(
												(minute) => {
													return (
														<SelectItem
															key={`minute-${minute}`}
															value={`${minute}`}
														>
															{minute.toString().padStart(2, "0")}
														</SelectItem>
													);
												},
											)}
										</SelectContent>
									</Select>
								</div>
								<div className="sm:col-span-2">
									<Label>Days of week</Label>
									<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
										{WEEKDAY_OPTIONS.map((day) => {
											const inputId = `routine-day-${day.value.toLowerCase()}`;
											const checked = createForm.scheduleDays.includes(
												day.value,
											);
											return (
												<Label
													className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
													htmlFor={inputId}
													key={day.value}
												>
													<Checkbox
														checked={checked}
														id={inputId}
														onCheckedChange={(value) =>
															setCreateForm((prev) => {
																const nextSet = new Set(prev.scheduleDays);
																if (value === true) {
																	nextSet.add(day.value);
																} else {
																	nextSet.delete(day.value);
																}
																return {
																	...prev,
																	scheduleDays: normalizeScheduleDays([
																		...nextSet,
																	]),
																};
															})
														}
													/>
													{day.label}
												</Label>
											);
										})}
									</div>
								</div>
								<div className="sm:col-span-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
									Cron:{" "}
									<span className="font-mono text-foreground">
										{cronPreview || "Select one or more days"}
									</span>
								</div>
							</div>
						</div>

						<div className="sm:col-span-2">
							<Label htmlFor="routine-prompt">Prompt</Label>
							<Textarea
								id="routine-prompt"
								value={createForm.prompt}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										prompt: event.target.value,
									}))
								}
								rows={4}
							/>
						</div>

						<div>
							<Label>Provider</Label>
							<Combobox
								items={availableProviders}
								onValueChange={(value) => {
									if (!value) {
										return;
									}
									const providerModelsForNext =
										visibleProviderModels[value] ?? [];
									const rememberedModel =
										lastModelSelection.lastModelByProvider[value];
									const nextModel =
										rememberedModel &&
										providerModelsForNext.includes(rememberedModel)
											? rememberedModel
											: (providerModelsForNext[0] ?? "");
									setCreateForm((prev) => ({
										...prev,
										provider: value,
										model: nextModel,
									}));
								}}
								value={createForm.provider}
							>
								<ComboboxInput
									className="h-9 w-full"
									readOnly
									showClear={false}
									showTrigger
								/>
								<ComboboxContent>
									<ComboboxEmpty>No providers found.</ComboboxEmpty>
									<ComboboxList>
										{(item) => (
											<ComboboxItem key={item} value={item}>
												{item}
											</ComboboxItem>
										)}
									</ComboboxList>
								</ComboboxContent>
							</Combobox>
						</div>

						<div>
							<Label>Model</Label>
							<Combobox
								items={availableModelsForProvider}
								onValueChange={(value) => {
									if (!value) {
										return;
									}
									setCreateForm((prev) => ({ ...prev, model: value }));
								}}
								value={createForm.model}
							>
								<ComboboxInput
									className="h-9 w-full"
									readOnly
									showClear={false}
									showTrigger
								/>
								<ComboboxContent>
									<ComboboxEmpty>No models found.</ComboboxEmpty>
									<ComboboxList>
										{(item) => (
											<ComboboxItem key={item} value={item}>
												{item}
											</ComboboxItem>
										)}
									</ComboboxList>
								</ComboboxContent>
							</Combobox>
						</div>

						<div className="sm:col-span-2">
							<Label htmlFor="routine-workspace">Workspace root</Label>
							<Input
								id="routine-workspace"
								value={createForm.workspaceRoot}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										workspaceRoot: event.target.value,
									}))
								}
							/>
						</div>

						<div className="sm:col-span-2">
							<Label htmlFor="routine-system-prompt">
								System prompt (optional)
							</Label>
							<Textarea
								id="routine-system-prompt"
								value={createForm.systemPrompt}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										systemPrompt: event.target.value,
									}))
								}
								rows={3}
							/>
						</div>

						<div>
							<Label htmlFor="routine-timeout">
								Timeout seconds (optional)
							</Label>
							<Input
								id="routine-timeout"
								value={createForm.timeoutSeconds}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										timeoutSeconds: event.target.value,
									}))
								}
								placeholder="3600"
							/>
						</div>

						<div>
							<Label htmlFor="routine-tags">
								Tags (comma-separated, optional)
							</Label>
							<Input
								id="routine-tags"
								value={createForm.tags}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										tags: event.target.value,
									}))
								}
								placeholder="automation,review"
							/>
						</div>
					</div>

					{createFormError && (
						<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{createFormError}
						</div>
					)}

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setIsCreateOpen(false)}
							disabled={isCreating}
						>
							Cancel
						</Button>
						<Button
							onClick={() => void submitCreateForm()}
							disabled={isCreating}
						>
							{isCreating
								? editingSchedule
									? "Saving..."
									: "Creating..."
								: editingSchedule
									? "Save Changes"
									: "Create Schedule"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</PageFrame>
	);
}
