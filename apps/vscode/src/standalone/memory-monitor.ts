import { telemetryService } from "@/services/telemetry"
import { coreConnectionBacklog } from "./core-connection-backlog"
import { log } from "./utils"

const MEMORY_LOG_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const BYTES_TO_MB = 1024 * 1024

let memoryMonitorInterval: ReturnType<typeof setInterval> | null = null

/**
 * Logs current memory usage in a structured, grep-friendly format.
 * Called periodically by the monitor timer, and also exported so that
 * other code can call it on-demand at important lifecycle moments
 * (e.g., after task completion, after context truncation).
 */
function logMemoryUsage(): void {
	const mem = process.memoryUsage()
	const uptime = Math.round(process.uptime())

	const rss = Math.round(mem.rss / BYTES_TO_MB)
	const heapUsed = Math.round(mem.heapUsed / BYTES_TO_MB)
	const heapTotal = Math.round(mem.heapTotal / BYTES_TO_MB)
	const external = Math.round(mem.external / BYTES_TO_MB)
	const arrayBuffers = Math.round(mem.arrayBuffers / BYTES_TO_MB)

	log(
		`[MEMORY] rss=${rss}MB heapUsed=${heapUsed}MB heapTotal=${heapTotal}MB ` +
			`external=${external}MB arrayBuffers=${arrayBuffers}MB uptime=${uptime}s`,
	)
}

/**
 * Reports the peak depth of each host-bound response stream's forward queue
 * since the previous report, on the memory monitor's cadence: a queue that
 * keeps growing is the memory, before the heap number shows it.
 */
function reportStreamBacklog(): void {
	for (const [qualifiedMethod, peak] of coreConnectionBacklog.takePeaks()) {
		const dot = qualifiedMethod.lastIndexOf(".")
		// A gauge series keeps exporting its last value until it is cleared, so a
		// method's first quiet window retires its series rather than reporting 0.
		telemetryService.captureGrpcStreamBacklog(
			peak > 0 ? peak : null,
			qualifiedMethod.slice(0, dot),
			qualifiedMethod.slice(dot + 1),
		)
		if (peak > 2) {
			log(`[BACKLOG] ${qualifiedMethod} peak=${peak} queued responses`)
		}
	}
}

function tick(): void {
	logMemoryUsage()
	reportStreamBacklog()
}

/**
 * Starts periodic memory usage logging.
 *
 * Logs immediately on start to capture a baseline, then repeats every
 * MEMORY_LOG_INTERVAL_MS (5 minutes). The timer is unref'd so it won't
 * prevent Node.js from exiting when all other work is done.
 */
export function startMemoryMonitoring(): void {
	if (memoryMonitorInterval) {
		return // Already running
	}

	// Log immediately on start to capture baseline
	logMemoryUsage()

	memoryMonitorInterval = setInterval(tick, MEMORY_LOG_INTERVAL_MS)

	// IMPORTANT: unref() tells Node.js that this timer is "optional" — it
	// should not keep the event loop alive by itself. Without this call,
	// the process could never exit cleanly because it would always be
	// waiting for the next 5-minute interval tick. Node.js exits when
	// there are no more active handles (timers, sockets, etc.) keeping
	// the event loop alive. unref() removes this timer from that count.
	memoryMonitorInterval.unref()

	log("[MEMORY] Periodic memory monitoring started (interval: 5m)")
}

/**
 * Stops periodic memory usage logging and logs a final snapshot.
 * Called during graceful shutdown to capture end-of-life memory state.
 */
export function stopMemoryMonitoring(): void {
	if (memoryMonitorInterval) {
		tick() // Final snapshot
		clearInterval(memoryMonitorInterval)
		memoryMonitorInterval = null
		log("[MEMORY] Periodic memory monitoring stopped")
	}
}
