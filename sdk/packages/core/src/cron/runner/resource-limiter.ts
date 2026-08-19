export class ResourceLimiter {
	private readonly globalMaxConcurrency: number;
	private readonly activeExecutions = new Map<string, Set<string>>();

	constructor(globalMaxConcurrency: number) {
		this.globalMaxConcurrency = Math.max(1, Math.floor(globalMaxConcurrency));
	}

	public acquire(
		scheduleId: string,
		executionId: string,
		maxParallel: number,
	): boolean {
		if (this.getGlobalActiveCount() >= this.globalMaxConcurrency) {
			return false;
		}
		const perScheduleLimit = Math.max(1, Math.floor(maxParallel));
		const scheduleExecutions =
			this.activeExecutions.get(scheduleId) ?? new Set<string>();
		if (scheduleExecutions.size >= perScheduleLimit) {
			return false;
		}
		scheduleExecutions.add(executionId);
		this.activeExecutions.set(scheduleId, scheduleExecutions);
		return true;
	}

	public release(scheduleId: string, executionId: string): void {
		const executions = this.activeExecutions.get(scheduleId);
		if (!executions) {
			return;
		}
		executions.delete(executionId);
		if (executions.size === 0) {
			this.activeExecutions.delete(scheduleId);
		}
	}

	public getGlobalActiveCount(): number {
		let total = 0;
		for (const executions of this.activeExecutions.values()) {
			total += executions.size;
		}
		return total;
	}
}
