"use client";

import {
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
} from "@cline/shared/browser";
import {
	CheckCircle2,
	Circle,
	Clock3,
	ExternalLink,
	Eye,
	Pause,
	Pencil,
	Play,
	PlayIcon,
	Plus,
	RefreshCw,
	Trash2,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
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
	cline: ["anthropic/claude-sonnet-4.6"],
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
	scheduleType: "once" | "daily" | "weekly";
	scheduleDate: string;
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
			"openai/gpt-5.3-codex",
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

function formatScheduleDays(days: string[]): string {
	const normalized = normalizeScheduleDays(days);
	if (normalized.length === WEEKDAY_OPTIONS.length) {
		return "Every day";
	}
	if (normalized.join(",") === ["MON", "TUE", "WED", "THU", "FRI"].join(",")) {
		return "Weekdays";
	}
	return normalized
		.map(
			(value) =>
				WEEKDAY_OPTIONS.find((option) => option.value === value)?.label ??
				value,
		)
		.join(", ");
}

function formatScheduleTime(hour: string, minute: string): string {
	const date = new Date();
	date.setHours(
		Number.parseInt(hour, 10) || 0,
		Number.parseInt(minute, 10) || 0,
		0,
		0,
	);
	return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatLocalDateInput(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function formatLocalTimeInput(date: Date): string {
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${hour}:${minute}`;
}

function minimumOneTimeDateTime(now = new Date()): {
	date: string;
	time: string;
} {
	const minimum = new Date(now.getTime() + 60_000);
	minimum.setSeconds(0, 0);
	return {
		date: formatLocalDateInput(minimum),
		time: formatLocalTimeInput(minimum),
	};
}

function defaultScheduleDate(): string {
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	return formatLocalDateInput(tomorrow);
}

function buildRunAt(form: RoutineFormState): number | undefined {
	if (!form.scheduleDate) {
		return undefined;
	}
	const runAt = new Date(
		`${form.scheduleDate}T${form.scheduleHour.padStart(2, "0")}:${form.scheduleMinute.padStart(2, "0")}:00`,
	).getTime();
	return Number.isFinite(runAt) ? runAt : undefined;
}

function formatExecutionTimestamp(execution: RoutineExecution): string {
	return formatDateTime(
		execution.endedAt ?? execution.startedAt ?? execution.triggeredAt,
	);
}

function formatScheduleTrigger(schedule: RoutineSchedule): string {
	if (schedule.cronPattern === ONE_TIME_SCHEDULE_CRON_PATTERN) {
		return `Once · ${formatDateTime(getOneTimeScheduleRunAt(schedule))}`;
	}
	const parsed = parseCronPattern(schedule.cronPattern);
	return parsed.scheduleType === "daily"
		? `Daily · ${formatScheduleTime(parsed.scheduleHour, parsed.scheduleMinute)}`
		: `${formatScheduleDays(parsed.scheduleDays)} · ${formatScheduleTime(parsed.scheduleHour, parsed.scheduleMinute)}`;
}

function getOneTimeScheduleRunAt(
	schedule: RoutineSchedule,
): number | undefined {
	const runAt = schedule.metadata?.[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY];
	return typeof runAt === "number" && Number.isFinite(runAt)
		? runAt
		: undefined;
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
): Pick<
	RoutineFormState,
	"scheduleType" | "scheduleHour" | "scheduleMinute" | "scheduleDays"
> {
	const parts = cronPattern.trim().split(/\s+/);
	const minute = Number.parseInt(parts[0] ?? "", 10);
	const hour = Number.parseInt(parts[1] ?? "", 10);
	const days = expandCronDays(parts[4]);
	return {
		scheduleType: parts[4] === "*" ? "daily" : "weekly",
		scheduleHour:
			Number.isInteger(hour) && hour >= 0 && hour <= 23 ? String(hour) : "9",
		scheduleMinute:
			Number.isInteger(minute) && minute >= 0 && minute <= 59
				? String(minute)
				: "0",
		scheduleDays: days.length > 0 ? days : ["MON", "TUE", "WED", "THU", "FRI"],
	};
}

function parseScheduleTrigger(
	schedule: RoutineSchedule,
): Pick<
	RoutineFormState,
	| "scheduleType"
	| "scheduleDate"
	| "scheduleHour"
	| "scheduleMinute"
	| "scheduleDays"
> {
	if (schedule.cronPattern === ONE_TIME_SCHEDULE_CRON_PATTERN) {
		const date = new Date(
			getOneTimeScheduleRunAt(schedule) ?? schedule.nextRunAt ?? Date.now(),
		);
		return {
			scheduleType: "once",
			scheduleDate: formatLocalDateInput(date),
			scheduleHour: String(date.getHours()),
			scheduleMinute: String(date.getMinutes()),
			scheduleDays: ["MON", "TUE", "WED", "THU", "FRI"],
		};
	}
	return {
		...parseCronPattern(schedule.cronPattern),
		scheduleDate: defaultScheduleDate(),
	};
}

export function RoutineSchedulesContent({
	onOpenSession,
}: {
	onOpenSession?: (sessionId: string) => void | Promise<void>;
}) {
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
	// Sets rather than single ids: several rows can have in-flight actions at
	// once, and one action finishing must not clear another row's busy state.
	const [busyScheduleIds, setBusyScheduleIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [triggeringScheduleIds, setTriggeringScheduleIds] = useState<
		ReadonlySet<string>
	>(new Set());
	// Ref mirrors busyScheduleIds so a second click on the same row is
	// rejected synchronously — two rapid clicks can both fire before React
	// re-renders the disabled state, and state alone can't distinguish them.
	const busyScheduleIdsRef = useRef<Set<string>>(new Set());
	const beginScheduleAction = (scheduleId: string): boolean => {
		if (busyScheduleIdsRef.current.has(scheduleId)) {
			return false;
		}
		busyScheduleIdsRef.current.add(scheduleId);
		setBusyScheduleIds(new Set(busyScheduleIdsRef.current));
		return true;
	};
	const endScheduleAction = (scheduleId: string) => {
		busyScheduleIdsRef.current.delete(scheduleId);
		setBusyScheduleIds(new Set(busyScheduleIdsRef.current));
	};
	const setScheduleTriggering = (scheduleId: string, triggering: boolean) => {
		setTriggeringScheduleIds((previous) => {
			const next = new Set(previous);
			if (triggering) {
				next.add(scheduleId);
			} else {
				next.delete(scheduleId);
			}
			return next;
		});
	};
	const [viewingSchedule, setViewingSchedule] =
		useState<RoutineSchedule | null>(null);
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
		scheduleType: "once",
		scheduleDate: defaultScheduleDate(),
		scheduleHour: "9",
		scheduleMinute: "0",
		scheduleDays: ["MON", "TUE", "WED", "THU", "FRI"],
		prompt: "Review PRs opened yesterday and summarize issues.",
		provider: "cline",
		model: "openai/gpt-5.3-codex",
		workspaceRoot: "",
		systemPrompt: "",
		timeoutSeconds: "",
		tags: "",
		enabled: true,
	});
	const minimumOnce = minimumOneTimeDateTime();

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
		if (!beginScheduleAction(schedule.scheduleId)) {
			return;
		}
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
			endScheduleAction(schedule.scheduleId);
		}
	};

	const triggerSchedule = async (schedule: RoutineSchedule) => {
		if (!beginScheduleAction(schedule.scheduleId)) {
			return;
		}
		setScheduleTriggering(schedule.scheduleId, true);
		setErrorMessage(null);
		try {
			await desktopClient.invoke("trigger_routine_schedule", {
				schedule_id: schedule.scheduleId,
			});
			toast({
				title: "Run started",
				description: `"${schedule.name}" was queued to run now.`,
			});
			await refreshSchedules({ force: true, showLoading: false });
			window.setTimeout(() => {
				void refreshSchedules({ force: true, showLoading: false });
			}, 1_000);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
			toast({
				title: "Failed to start run",
				description: message,
				variant: "destructive",
			});
		} finally {
			endScheduleAction(schedule.scheduleId);
			setScheduleTriggering(schedule.scheduleId, false);
		}
	};

	const deleteSchedule = async (scheduleId: string) => {
		if (!beginScheduleAction(scheduleId)) {
			return;
		}
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
			endScheduleAction(scheduleId);
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
			scheduleType: "once",
			scheduleDate: defaultScheduleDate(),
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
		const { provider, model } = getScheduleProviderModel(schedule);
		const parsedTrigger = parseScheduleTrigger(schedule);
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
			...parsedTrigger,
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
		const runAt =
			createForm.scheduleType === "once" ? buildRunAt(createForm) : undefined;
		if (createForm.scheduleType === "once" && (!runAt || runAt <= Date.now())) {
			setCreateFormError("Choose a one-time date and time in the future.");
			return;
		}
		const cronPattern =
			createForm.scheduleType === "daily"
				? buildCronPattern(
						WEEKDAY_OPTIONS.map((option) => option.value),
						createForm.scheduleHour,
						createForm.scheduleMinute,
					)
				: createForm.scheduleType === "weekly"
					? buildCronPattern(
							createForm.scheduleDays,
							createForm.scheduleHour,
							createForm.scheduleMinute,
						)
					: undefined;
		if (createForm.scheduleType === "weekly" && !cronPattern) {
			setCreateFormError("Select at least one weekday.");
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
				"openai/gpt-5.3-codex";
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
				schedule_type:
					createForm.scheduleType === "once" ? "once" : "recurring",
				run_at: runAt,
				cron_pattern: cronPattern,
				prompt,
				provider,
				model,
				mode: "act",
				workspace_root: workspaceRoot,
				cwd: workspaceRoot,
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

	const viewingExecutions = useMemo(() => {
		if (!viewingSchedule) {
			return [];
		}
		return [...lastExecutions]
			.filter(
				(execution) => execution.scheduleId === viewingSchedule.scheduleId,
			)
			.sort((left, right) => {
				const leftTime = new Date(
					left.endedAt ?? left.startedAt ?? left.triggeredAt ?? 0,
				).getTime();
				const rightTime = new Date(
					right.endedAt ?? right.startedAt ?? right.triggeredAt ?? 0,
				).getTime();
				return rightTime - leftTime;
			});
	}, [lastExecutions, viewingSchedule]);

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
						const isBusy = busyScheduleIds.has(schedule.scheduleId);
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
										{formatScheduleTrigger(schedule)}
									</span>
									<div className="flex-1" />
									<div className="flex items-center gap-1">
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`View ${schedule.name}`}
													onClick={() => setViewingSchedule(schedule)}
												>
													<Eye className="h-3.5 w-3.5" />
												</Button>
											</TooltipTrigger>
											<TooltipContent>View details</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Edit ${schedule.name}`}
													onClick={() => openEditDialog(schedule)}
													disabled={isBusy}
												>
													<Pencil className="h-3.5 w-3.5" />
												</Button>
											</TooltipTrigger>
											<TooltipContent>Edit schedule</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Run ${schedule.name} now`}
													onClick={() => void triggerSchedule(schedule)}
													disabled={isBusy}
												>
													{triggeringScheduleIds.has(schedule.scheduleId) ? (
														<RefreshCw className="h-3.5 w-3.5 animate-spin" />
													) : (
														<PlayIcon className="h-3.5 w-3.5" />
													)}
												</Button>
											</TooltipTrigger>
											<TooltipContent>Run now</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={
														schedule.enabled
															? `Pause ${schedule.name}`
															: `Resume ${schedule.name}`
													}
													onClick={() =>
														void upsertScheduleEnabled(
															schedule,
															!schedule.enabled,
														)
													}
													disabled={isBusy}
												>
													{schedule.enabled ? (
														<Pause className="h-3.5 w-3.5" />
													) : (
														<Play className="h-3.5 w-3.5" />
													)}
												</Button>
											</TooltipTrigger>
											<TooltipContent>
												{schedule.enabled
													? "Pause schedule"
													: "Resume schedule"}
											</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Delete ${schedule.name}`}
													onClick={() => setSchedulePendingDelete(schedule)}
													disabled={isBusy}
												>
													<Trash2 className="h-3.5 w-3.5" />
												</Button>
											</TooltipTrigger>
											<TooltipContent>Delete schedule</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<Switch
													checked={schedule.enabled}
													onCheckedChange={(checked) =>
														void upsertScheduleEnabled(schedule, checked)
													}
													disabled={isBusy}
													aria-label={`Enable ${schedule.name}`}
												/>
											</TooltipTrigger>
											<TooltipContent>
												{schedule.enabled
													? "Enabled — click to disable"
													: "Disabled — click to enable"}
											</TooltipContent>
										</Tooltip>
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
			<Dialog
				open={Boolean(viewingSchedule)}
				onOpenChange={(open) => {
					if (!open) {
						setViewingSchedule(null);
					}
				}}
			>
				<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>{viewingSchedule?.name ?? "Schedule"}</DialogTitle>
						<DialogDescription>
							Full configuration for this schedule.
						</DialogDescription>
					</DialogHeader>
					{viewingSchedule && (
						<Tabs defaultValue="overview">
							<TabsList>
								<TabsTrigger value="overview">Overview</TabsTrigger>
								<TabsTrigger value="runs">
									Runs
									{viewingExecutions.length > 0 && (
										<span className="ml-1 text-xs text-muted-foreground">
											{viewingExecutions.length}
										</span>
									)}
								</TabsTrigger>
							</TabsList>
							<TabsContent
								className="mt-4 flex flex-col gap-3"
								value="overview"
							>
								<div className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
									<p>
										<span className="text-muted-foreground/70">Schedule:</span>{" "}
										{formatScheduleTrigger(viewingSchedule)}
									</p>
									<p>
										<span className="text-muted-foreground/70">Mode:</span>{" "}
										{viewingSchedule.mode}
									</p>
									<p>
										<span className="text-muted-foreground/70">Model:</span>{" "}
										{formatScheduleModel(viewingSchedule)}
									</p>
									<p>
										<span className="text-muted-foreground/70">Enabled:</span>{" "}
										{viewingSchedule.enabled ? "yes" : "no"}
									</p>
									<p>
										<span className="text-muted-foreground/70">Last run:</span>{" "}
										{formatDateTime(viewingSchedule.lastRunAt)}
									</p>
									<p>
										<span className="text-muted-foreground/70">Next run:</span>{" "}
										{formatDateTime(viewingSchedule.nextRunAt)}
									</p>
								</div>
								<pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
									{JSON.stringify(viewingSchedule, null, 2)}
								</pre>
							</TabsContent>
							<TabsContent className="mt-4" value="runs">
								<div className="mb-2 flex items-center justify-between">
									<h3 className="text-sm font-semibold">Runs</h3>
									<span className="text-xs text-muted-foreground">
										{viewingExecutions.length} result
										{viewingExecutions.length === 1 ? "" : "s"}
									</span>
								</div>
								{viewingExecutions.length === 0 ? (
									<div className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
										No runs yet.
									</div>
								) : (
									<div className="overflow-hidden rounded-lg border border-border">
										{viewingExecutions.map((execution) => {
											const status = execution.status?.toLowerCase() ?? "";
											const succeeded = ["success", "completed"].includes(
												status,
											);
											const failed = ["failed", "timeout", "aborted"].includes(
												status,
											);
											return (
												<button
													className="group flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
													disabled={!execution.sessionId || !onOpenSession}
													key={execution.executionId}
													onClick={() => {
														if (execution.sessionId) {
															void onOpenSession?.(execution.sessionId);
														}
													}}
													type="button"
												>
													{succeeded ? (
														<CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
													) : failed ? (
														<XCircle className="size-4 shrink-0 text-destructive" />
													) : (
														<Clock3 className="size-4 shrink-0 text-muted-foreground" />
													)}
													<span className="min-w-0 flex-1">
														<span className="block truncate font-medium capitalize">
															{execution.status || "Unknown result"}
														</span>
														{execution.errorMessage && (
															<span className="block truncate text-xs text-destructive">
																{execution.errorMessage}
															</span>
														)}
													</span>
													<span className="shrink-0 text-xs text-muted-foreground">
														{formatExecutionTimestamp(execution)}
													</span>
													{execution.sessionId && onOpenSession && (
														<ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
													)}
												</button>
											);
										})}
									</div>
								)}
							</TabsContent>
						</Tabs>
					)}
				</DialogContent>
			</Dialog>
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
									? busyScheduleIds.has(schedulePendingDelete.scheduleId)
									: false
							}
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								!schedulePendingDelete ||
								busyScheduleIds.has(schedulePendingDelete.scheduleId)
							}
							onClick={() => {
								if (schedulePendingDelete) {
									void deleteSchedule(schedulePendingDelete.scheduleId);
								}
							}}
							className={buttonVariants({ variant: "destructive" })}
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
							<div className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-3">
								<div className="min-w-32 flex-1">
									<Label htmlFor="routine-schedule-type">Frequency</Label>
									<Select
										onValueChange={(value) =>
											setCreateForm((prev) => ({
												...prev,
												scheduleType:
													value === "once" || value === "daily"
														? value
														: "weekly",
											}))
										}
										value={createForm.scheduleType}
									>
										<SelectTrigger
											className="w-full"
											id="routine-schedule-type"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="once">Once</SelectItem>
											<SelectItem value="daily">Daily</SelectItem>
											<SelectItem value="weekly">Weekly</SelectItem>
										</SelectContent>
									</Select>
								</div>
								{createForm.scheduleType === "once" && (
									<div className="min-w-40 flex-1">
										<Label htmlFor="routine-date">Date</Label>
										<Input
											id="routine-date"
											min={minimumOnce.date}
											onChange={(event) => {
												const selectedDate = event.target.value;
												setCreateForm((prev) => {
													const scheduleDate =
														selectedDate < minimumOnce.date
															? minimumOnce.date
															: selectedDate;
													const currentTime = `${prev.scheduleHour.padStart(2, "0")}:${prev.scheduleMinute.padStart(2, "0")}`;
													const useMinimumTime =
														scheduleDate === minimumOnce.date &&
														currentTime < minimumOnce.time;
													const [minimumHour, minimumMinute] =
														minimumOnce.time.split(":");
													return {
														...prev,
														scheduleDate,
														scheduleHour: useMinimumTime
															? String(Number.parseInt(minimumHour, 10))
															: prev.scheduleHour,
														scheduleMinute: useMinimumTime
															? String(Number.parseInt(minimumMinute, 10))
															: prev.scheduleMinute,
													};
												});
											}}
											type="date"
											value={createForm.scheduleDate}
										/>
									</div>
								)}
								{createForm.scheduleType === "weekly" && (
									<div className="min-w-44 flex-[1.4]">
										<Label>Days</Label>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													className="w-full justify-between font-normal"
													variant="outline"
												>
													<span className="truncate">
														{formatScheduleDays(createForm.scheduleDays) ||
															"Choose days"}
													</span>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="start" className="w-48">
												{WEEKDAY_OPTIONS.map((day) => (
													<DropdownMenuCheckboxItem
														checked={createForm.scheduleDays.includes(
															day.value,
														)}
														key={day.value}
														onCheckedChange={(checked) =>
															setCreateForm((prev) => {
																const days = new Set(prev.scheduleDays);
																if (checked) days.add(day.value);
																else days.delete(day.value);
																return {
																	...prev,
																	scheduleDays: normalizeScheduleDays([
																		...days,
																	]),
																};
															})
														}
														onSelect={(event) => event.preventDefault()}
													>
														{day.label}
													</DropdownMenuCheckboxItem>
												))}
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								)}
								<div className="min-w-32 flex-1">
									<Label htmlFor="routine-time">Time</Label>
									<Input
										id="routine-time"
										min={
											createForm.scheduleType === "once" &&
											createForm.scheduleDate === minimumOnce.date
												? minimumOnce.time
												: undefined
										}
										onChange={(event) => {
											const selectedTime =
												createForm.scheduleType === "once" &&
												createForm.scheduleDate === minimumOnce.date &&
												event.target.value < minimumOnce.time
													? minimumOnce.time
													: event.target.value;
											const [hour, minute] = selectedTime.split(":");
											if (hour !== undefined && minute !== undefined) {
												setCreateForm((prev) => ({
													...prev,
													scheduleHour: String(Number.parseInt(hour, 10)),
													scheduleMinute: String(Number.parseInt(minute, 10)),
												}));
											}
										}}
										type="time"
										value={`${createForm.scheduleHour.padStart(2, "0")}:${createForm.scheduleMinute.padStart(2, "0")}`}
									/>
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
