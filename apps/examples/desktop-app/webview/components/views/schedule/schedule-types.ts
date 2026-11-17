export type DateTimeValue = number | string;

export interface Schedule {
	scheduleId: string;
	name: string;
	cronPattern: string;
	timezone?: string;
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

export interface ScheduleExecution {
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

export interface ScheduleOverviewResponse {
	schedules: Schedule[];
	activeExecutions: ScheduleExecution[];
	lastExecutions: ScheduleExecution[];
}

export interface ProcessContext {
	workspaceRoot: string;
	cwd: string;
}

export interface ScheduleFormState {
	name: string;
	description: string;
	scheduleType: "daily" | "weekly" | "once";
	scheduleDate: string;
	scheduleHour: string;
	scheduleMinute: string;
	scheduleDays: string[];
	prompt: string;
	provider: string;
	model: string;
	mode: Schedule["mode"];
	workspaceRoot: string;
	systemPrompt: string;
	timeoutSeconds: string;
	tags: string;
	enabled: boolean;
}
