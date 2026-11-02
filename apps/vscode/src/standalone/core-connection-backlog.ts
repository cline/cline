/**
 * Depth of the per-request forward queue in core-connection-protocol: responses a
 * streaming handler has posted that the host has not yet consumed. Producers such
 * as sendStateUpdate post without waiting, so nothing bounds this queue, and every
 * queued state update holds a full stateJson. The peak depth over a reporting
 * window is therefore what separates a host that keeps up (1 or 2) from a backlog
 * on its way to the heap limit (cline/cline#15031). Peaks reset on read so each
 * window stands on its own.
 */
export class StreamBacklog {
	private readonly pending = new Map<string, number>()
	private readonly peak = new Map<string, number>()
	/** Methods the previous report showed with a backlog; they owe the reader one empty window. */
	private readonly reported = new Set<string>()

	enter(qualifiedMethod: string): void {
		const depth = (this.pending.get(qualifiedMethod) ?? 0) + 1
		this.pending.set(qualifiedMethod, depth)
		if (depth > (this.peak.get(qualifiedMethod) ?? 0)) {
			this.peak.set(qualifiedMethod, depth)
		}
	}

	leave(qualifiedMethod: string): void {
		const depth = (this.pending.get(qualifiedMethod) ?? 1) - 1
		if (depth <= 0) {
			this.pending.delete(qualifiedMethod)
		} else {
			this.pending.set(qualifiedMethod, depth)
		}
	}

	depth(qualifiedMethod: string): number {
		return this.pending.get(qualifiedMethod) ?? 0
	}

	/**
	 * Peak depth per method since the previous call, for every method that had
	 * something queued in the window. The next window starts from the current
	 * depth, so a backlog that never drains keeps reporting. A method reported
	 * in the previous window and quiet in this one is reported once more as 0,
	 * so the reader sees it recover instead of its last peak lingering.
	 */
	takePeaks(): Map<string, number> {
		const peaks = new Map(this.peak)
		for (const qualifiedMethod of this.reported) {
			if (!peaks.has(qualifiedMethod)) {
				peaks.set(qualifiedMethod, 0)
			}
		}
		this.reported.clear()
		for (const [qualifiedMethod, peak] of peaks) {
			if (peak > 0) {
				this.reported.add(qualifiedMethod)
			}
		}
		this.peak.clear()
		for (const [qualifiedMethod, depth] of this.pending) {
			this.peak.set(qualifiedMethod, depth)
		}
		return peaks
	}
}

export const coreConnectionBacklog = new StreamBacklog()
