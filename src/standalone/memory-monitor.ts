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
export function logMemoryUsage(): void {
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

	memoryMonitorInterval = setInterval(logMemoryUsage, MEMORY_LOG_INTERVAL_MS)

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
		logMemoryUsage() // Final snapshot
		clearInterval(memoryMonitorInterval)
		memoryMonitorInterval = null
		log("[MEMORY] Periodic memory monitoring stopped")
	}
}
