import {
	type EventLoopUtilization,
	monitorEventLoopDelay,
	performance,
} from "node:perf_hooks";
import type { ResolvedResourcePolicy } from "./policy";

export interface ResourceDiagnosticsSnapshot {
	timestamp: string;
	processUptimeSeconds: number;
	memory: NodeJS.MemoryUsage;
	eventLoop: {
		utilization: number;
		activeMilliseconds: number;
		idleMilliseconds: number;
		delayMeanMilliseconds: number;
		delayP50Milliseconds: number;
		delayP99Milliseconds: number;
		delayMaxMilliseconds: number;
	};
}

export type ResourceDiagnosticsListener = (
	snapshot: ResourceDiagnosticsSnapshot,
) => void;

export interface ResourceDiagnosticsApi {
	readonly policy: ResolvedResourcePolicy;
	getSnapshot(): ResourceDiagnosticsSnapshot;
	sample(): ResourceDiagnosticsSnapshot;
	subscribe(listener: ResourceDiagnosticsListener): () => void;
}

function nanosecondsToMilliseconds(value: number): number {
	return Number.isFinite(value) ? value / 1_000_000 : 0;
}

export class ResourceMonitor implements ResourceDiagnosticsApi {
	readonly policy: ResolvedResourcePolicy;
	private readonly listeners = new Set<ResourceDiagnosticsListener>();
	private readonly eventLoopDelay;
	private previousEventLoopUtilization: EventLoopUtilization;
	private latest: ResourceDiagnosticsSnapshot;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(policy: ResolvedResourcePolicy) {
		this.policy = policy;
		this.eventLoopDelay = monitorEventLoopDelay({
			resolution: policy.profile.diagnostics.eventLoopResolutionMs,
		});
		this.previousEventLoopUtilization = performance.eventLoopUtilization();
		this.latest = this.capture();
		if (policy.profile.diagnostics.enabled) {
			this.eventLoopDelay.enable();
			this.timer = setInterval(
				() => this.sample(),
				policy.profile.diagnostics.sampleIntervalMs,
			);
			this.timer.unref?.();
		}
	}

	getSnapshot(): ResourceDiagnosticsSnapshot {
		return this.latest;
	}

	sample(): ResourceDiagnosticsSnapshot {
		this.latest = this.capture();
		this.eventLoopDelay.reset();
		for (const listener of this.listeners) {
			try {
				listener(this.latest);
			} catch {
				// Diagnostics observers cannot affect runtime work.
			}
		}
		return this.latest;
	}

	subscribe(listener: ResourceDiagnosticsListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.eventLoopDelay.disable();
		this.listeners.clear();
	}

	private capture(): ResourceDiagnosticsSnapshot {
		const utilization = performance.eventLoopUtilization(
			this.previousEventLoopUtilization,
		);
		this.previousEventLoopUtilization = performance.eventLoopUtilization();
		return {
			timestamp: new Date().toISOString(),
			processUptimeSeconds: process.uptime(),
			memory: process.memoryUsage(),
			eventLoop: {
				utilization: utilization.utilization,
				activeMilliseconds: utilization.active,
				idleMilliseconds: utilization.idle,
				delayMeanMilliseconds: nanosecondsToMilliseconds(
					this.eventLoopDelay.mean,
				),
				delayP50Milliseconds: nanosecondsToMilliseconds(
					this.eventLoopDelay.percentile(50),
				),
				delayP99Milliseconds: nanosecondsToMilliseconds(
					this.eventLoopDelay.percentile(99),
				),
				delayMaxMilliseconds: nanosecondsToMilliseconds(
					this.eventLoopDelay.max,
				),
			},
		};
	}
}
