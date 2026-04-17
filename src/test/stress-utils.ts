import { monitorEventLoopDelay, performance } from "node:perf_hooks"

export interface MemorySnapshot {
	heapUsed: number
	heapTotal: number
	external: number
	arrayBuffers: number
	rss: number
}

export interface ActiveHandleSnapshot {
	count: number
	types: string[]
}

export interface ProcessResourceSnapshot {
	timestampMs: number
	performanceNowMs: number
	memory: MemorySnapshot
	activeHandles: ActiveHandleSnapshot
}

export interface ProcessResourceDiff {
	durationMs: number
	heapUsedDelta: number
	heapTotalDelta: number
	externalDelta: number
	arrayBuffersDelta: number
	rssDelta: number
	activeHandleCountDelta: number
	activeHandleTypesAdded: string[]
}

export interface EventLoopLagStats {
	minMs: number
	maxMs: number
	meanMs: number
	stddevMs: number
	p50Ms: number
	p95Ms: number
	p99Ms: number
	runtimeMs: number
	sampleCountEstimate: number
}

export interface MeasuredAsyncOperation<TResult> {
	label: string
	result: TResult
	durationMs: number
	before: ProcessResourceSnapshot
	after: ProcessResourceSnapshot
	diff: ProcessResourceDiff
}

export interface StressFailureReport {
	label: string
	timestampMs: number
	durationMs: number
	before: ProcessResourceSnapshot
	after: ProcessResourceSnapshot
	diff: ProcessResourceDiff
	error?: {
		name: string
		message: string
	}
	eventLoopLag?: EventLoopLagStats
	annotations?: Record<string, string | number | boolean>
}

export const WORKSTREAM_E_LARGE_TEXT_FIXTURE_BYTES = 5 * 1024 * 1024
export const WORKSTREAM_E_VERY_LARGE_TEXT_FIXTURE_BYTES = 20 * 1024 * 1024

export interface GeneratedTextFixtureOptions {
	linePrefix?: string
	lineLength?: number
	fillChar?: string
}

export interface GeneratedPatchFileSpec {
	path: string
	content: string
}

function toMemorySnapshot(memoryUsage: NodeJS.MemoryUsage): MemorySnapshot {
	return {
		heapUsed: memoryUsage.heapUsed,
		heapTotal: memoryUsage.heapTotal,
		external: memoryUsage.external,
		arrayBuffers: memoryUsage.arrayBuffers,
		rss: memoryUsage.rss,
	}
}

function getActiveHandleTypes(): string[] {
	const getHandles = (
		process as NodeJS.Process & {
			_getActiveHandles?: () => unknown[]
		}
	)._getActiveHandles

	if (!getHandles) {
		return []
	}

	try {
		return getHandles.call(process).map((handle) => {
			const constructorName = (handle as { constructor?: { name?: string } })?.constructor?.name
			return constructorName || "UnknownHandle"
		})
	} catch {
		return []
	}
}

export function takeProcessResourceSnapshot(): ProcessResourceSnapshot {
	const activeHandleTypes = getActiveHandleTypes()

	return {
		timestampMs: Date.now(),
		performanceNowMs: performance.now(),
		memory: toMemorySnapshot(process.memoryUsage()),
		activeHandles: {
			count: activeHandleTypes.length,
			types: activeHandleTypes,
		},
	}
}

export function diffProcessResourceSnapshots(
	before: ProcessResourceSnapshot,
	after: ProcessResourceSnapshot,
): ProcessResourceDiff {
	const beforeTypeCounts = new Map<string, number>()
	for (const type of before.activeHandles.types) {
		beforeTypeCounts.set(type, (beforeTypeCounts.get(type) || 0) + 1)
	}

	const addedTypes: string[] = []
	const remainingBeforeCounts = new Map(beforeTypeCounts)
	for (const type of after.activeHandles.types) {
		const count = remainingBeforeCounts.get(type) || 0
		if (count > 0) {
			remainingBeforeCounts.set(type, count - 1)
		} else {
			addedTypes.push(type)
		}
	}

	return {
		durationMs: Math.max(0, after.performanceNowMs - before.performanceNowMs),
		heapUsedDelta: after.memory.heapUsed - before.memory.heapUsed,
		heapTotalDelta: after.memory.heapTotal - before.memory.heapTotal,
		externalDelta: after.memory.external - before.memory.external,
		arrayBuffersDelta: after.memory.arrayBuffers - before.memory.arrayBuffers,
		rssDelta: after.memory.rss - before.memory.rss,
		activeHandleCountDelta: after.activeHandles.count - before.activeHandles.count,
		activeHandleTypesAdded: addedTypes,
	}
}

export function measureUtf8Bytes(content: string): number {
	return Buffer.byteLength(content, "utf8")
}

export function createLargeTextFixture(targetBytes: number, options: GeneratedTextFixtureOptions = {}): string {
	if (targetBytes <= 0) {
		return ""
	}

	const linePrefix = options.linePrefix ?? "fixture-line"
	const lineLength = Math.max(16, options.lineLength ?? 96)
	const fillChar = (options.fillChar ?? "x").charAt(0) || "x"
	const lines: string[] = []
	let totalBytes = 0
	let index = 1

	while (totalBytes < targetBytes) {
		const prefix = `${linePrefix}-${String(index).padStart(6, "0")}-`
		const fillLength = Math.max(1, lineLength - prefix.length)
		const line = `${prefix}${fillChar.repeat(fillLength)}`
		lines.push(line)
		totalBytes += Buffer.byteLength(line, "utf8") + 1
		index += 1
	}

	return lines.join("\n")
}

export function createSingleLineFixture(targetBytes: number, fillChar = "x"): string {
	if (targetBytes <= 0) {
		return ""
	}
	return (fillChar.charAt(0) || "x").repeat(targetBytes)
}

export function createNotebookFixture(targetBytes: number): string {
	if (targetBytes <= 0) {
		return JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 })
	}

	const sourcePayload = createLargeTextFixture(Math.max(256, Math.floor(targetBytes * 0.45)), {
		linePrefix: "cell",
		lineLength: 88,
		fillChar: "s",
	})
	const outputPayload = createLargeTextFixture(Math.max(256, Math.floor(targetBytes * 0.35)), {
		linePrefix: "output",
		lineLength: 88,
		fillChar: "o",
	})

	const notebook = {
		cells: [
			{
				cell_type: "code",
				execution_count: 1,
				metadata: {
					generatedFixture: true,
				},
				outputs: [
					{
						output_type: "stream",
						name: "stdout",
						text: outputPayload.split("\n").map((line) => `${line}\n`),
					},
				],
				source: sourcePayload.split("\n").map((line) => `${line}\n`),
			},
		],
		metadata: {
			language_info: {
				name: "typescript",
			},
		},
		nbformat: 4,
		nbformat_minor: 5,
	}

	let serialized = JSON.stringify(notebook)
	const currentBytes = measureUtf8Bytes(serialized)
	if (currentBytes < targetBytes) {
		;(notebook.metadata as Record<string, unknown>).padding = "p".repeat(targetBytes - currentBytes)
		serialized = JSON.stringify(notebook)
	}

	return serialized
}

export function createMultiFilePatchFixture(files: GeneratedPatchFileSpec[]): string {
	const lines = ["*** Begin Patch"]
	for (const file of files) {
		lines.push(`*** Add File: ${file.path}`)
		for (const line of file.content.split("\n")) {
			lines.push(`+${line}`)
		}
	}
	lines.push("*** End Patch")
	return lines.join("\n")
}

export function createWorkstreamELargeTextFixture(): string {
	return createLargeTextFixture(WORKSTREAM_E_LARGE_TEXT_FIXTURE_BYTES)
}

export function createWorkstreamEVeryLargeTextFixture(): string {
	return createLargeTextFixture(WORKSTREAM_E_VERY_LARGE_TEXT_FIXTURE_BYTES)
}

export function createWorkstreamESingleLineFixture(targetBytes = WORKSTREAM_E_LARGE_TEXT_FIXTURE_BYTES): string {
	return createSingleLineFixture(targetBytes)
}

export function createWorkstreamENotebookFixture(targetBytes = WORKSTREAM_E_LARGE_TEXT_FIXTURE_BYTES): string {
	return createNotebookFixture(targetBytes)
}

export function assertUtf8ByteBudget(content: string, maxBytes: number, label = "content"): void {
	const actualBytes = measureUtf8Bytes(content)
	if (actualBytes > maxBytes) {
		throw new Error(
			`${label} exceeded UTF-8 byte budget: ${actualBytes} bytes > ${maxBytes} bytes ` +
				`(over by ${actualBytes - maxBytes} bytes)`,
		)
	}
}

export async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms))
}

function nanosToMs(nanos: number): number {
	return nanos / 1_000_000
}

export async function sampleEventLoopLagStats(runtimeMs = 50, resolutionMs = 10): Promise<EventLoopLagStats> {
	const histogram = monitorEventLoopDelay({ resolution: resolutionMs })
	histogram.enable()
	const startedAt = performance.now()
	try {
		await sleep(runtimeMs)
	} finally {
		histogram.disable()
	}

	const endedAt = performance.now()
	return {
		minMs: nanosToMs(histogram.min),
		maxMs: nanosToMs(histogram.max),
		meanMs: Number.isFinite(histogram.mean) ? nanosToMs(histogram.mean) : 0,
		stddevMs: Number.isFinite(histogram.stddev) ? nanosToMs(histogram.stddev) : 0,
		p50Ms: nanosToMs(histogram.percentile(50)),
		p95Ms: nanosToMs(histogram.percentile(95)),
		p99Ms: nanosToMs(histogram.percentile(99)),
		runtimeMs: Math.max(0, endedAt - startedAt),
		sampleCountEstimate: histogram.exceeds,
	}
}

export async function measureAsyncOperation<TResult>(
	label: string,
	operation: () => Promise<TResult>,
): Promise<MeasuredAsyncOperation<TResult>> {
	const before = takeProcessResourceSnapshot()
	const operationStart = performance.now()
	const result = await operation()
	const operationEnd = performance.now()
	const after = takeProcessResourceSnapshot()

	return {
		label,
		result,
		durationMs: Math.max(0, operationEnd - operationStart),
		before,
		after,
		diff: diffProcessResourceSnapshots(before, after),
	}
}

export function createStressFailureReport<TResult>(
	measured: MeasuredAsyncOperation<TResult>,
	options?: {
		error?: unknown
		eventLoopLag?: EventLoopLagStats
		annotations?: Record<string, string | number | boolean>
	},
): StressFailureReport {
	const error = options?.error
	const normalizedError = error
		? {
				name: error instanceof Error ? error.name : "UnknownError",
				message: error instanceof Error ? error.message : String(error),
			}
		: undefined

	return {
		label: measured.label,
		timestampMs: measured.after.timestampMs,
		durationMs: measured.durationMs,
		before: measured.before,
		after: measured.after,
		diff: measured.diff,
		error: normalizedError,
		eventLoopLag: options?.eventLoopLag,
		annotations: options?.annotations,
	}
}
