import { processCarriageReturns, applyRunLengthEncoding, truncateOutput } from "../../extract-text"

/**
 * Enhanced Benchmark test for terminal output processing functions
 *
 * This script tests terminal output processing with various data patterns:
 * 1. Regular output with carriage returns (various sizes)
 * 2. Extremely long single lines with carriage returns
 * 3. High-density carriage return patterns
 *
 * Tests with various data sizes and complexity levels for real-world performance metrics
 */

// Set a fixed random seed for reproducibility
const SEED = 12345
let seed = SEED

// Simple random number generator with seed
function random() {
	const x = Math.sin(seed++) * 10000
	return x - Math.floor(x)
}

// Generate random progress bar-like data with carriage returns
function generateTestData(size: number, complexity: "simple" | "medium" | "complex" = "medium"): string {
	seed = SEED // Reset seed for reproducibility

	let result = ""

	// Create lines of random content
	for (let i = 0; i < size; i++) {
		const line = `Processing file ${i}: `

		// For some lines, add progress bar updates with carriage returns
		if (random() < 0.3) {
			// 30% of lines have progress bars
			let progressUpdates: number

			switch (complexity) {
				case "simple":
					progressUpdates = Math.floor(random() * 5) + 1 // 1-5 updates
					break
				case "medium":
					progressUpdates = Math.floor(random() * 20) + 1 // 1-20 updates
					break
				case "complex":
					progressUpdates = Math.floor(random() * 50) + 1 // 1-50 updates
					break
			}

			for (let p = 0; p < progressUpdates; p++) {
				const progress = Math.floor((p / progressUpdates) * 100)
				// Ensure we never have negative values for repeat
				const progressChars = Math.max(0, p)
				const remainingChars = Math.max(0, 20 - p)
				const bar = `${line}[${"=".repeat(progressChars)}>${"-".repeat(remainingChars)}] ${progress}%\r`
				result += bar
			}

			// Add final state
			result += `${line}[${"=".repeat(20)}] 100%\n`
		} else {
			// Regular line
			result += `${line}Complete\n`
		}

		// Add more complex patterns for complex mode
		if (complexity === "complex" && random() < 0.1) {
			// Add ANSI escape sequences
			result += `\x1b[33mWarning: Slow operation detected\r\x1b[33mWarning: Fixed\x1b[0m\n`

			// Add Unicode with carriage returns
			if (random() < 0.5) {
				result += `处理中...\r已完成！\n`
			}

			// Add partial line overwrites
			if (random() < 0.5) {
				result += `Very long line with lots of text...\rShort\n`
			}

			// Add repeating patterns for RLE
			if (random() < 0.5) {
				result += `${"#".repeat(100)}\n`
			}

			// Add excessive new lines for truncation testing
			if (random() < 0.3) {
				result += "\n".repeat(Math.floor(random() * 10) + 1)
			}
		}
	}

	return result
}

// Generate a test with extremely long single lines
function generateLongLineTestData(lineLengthKB: number, updateCount: number): string {
	// Create a base string that's lineLengthKB kilobytes
	const baseLength = lineLengthKB * 1024
	let baseString = ""

	// Generate a long string with repeating characters
	for (let i = 0; i < baseLength; i++) {
		baseString += String.fromCharCode(32 + (i % 94)) // Printable ASCII chars
	}

	let result = baseString

	// Add carriage returns and modifications at various positions
	for (let i = 0; i < updateCount; i++) {
		// Calculate update position (divide the string into updateCount segments)
		const updateLength = Math.floor(baseLength / updateCount)
		const updatePosition = updateLength * i

		// Create update string that's 10% of the update segment length
		const modificationLength = Math.floor(updateLength * 0.1)
		let modification = ""
		for (let j = 0; j < modificationLength; j++) {
			modification += String.fromCharCode(65 + (j % 26)) // A-Z
		}

		// Add carriage return and modification
		result += `\r${modification}${baseString.substring(modification.length, updatePosition)}`
	}

	return result
}

// Generate high-density carriage return data
function generateHighDensityCRData(size: number): string {
	let result = ""

	// Create small text segments separated by carriage returns
	for (let i = 0; i < size; i++) {
		// Add a small text segment (3-10 chars)
		const segmentLength = 3 + Math.floor(random() * 8)
		let segment = ""
		for (let j = 0; j < segmentLength; j++) {
			segment += String.fromCharCode(97 + Math.floor(random() * 26)) // a-z
		}

		result += segment

		// 90% chance to add a carriage return
		if (random() < 0.9) {
			result += "\r"
		} else {
			result += "\n"
		}
	}

	return result
}

// Get appropriate iteration count for different sizes to ensure meaningful timing
function getIterationCount(size: number): number {
	if (size <= 10000) return 100
	if (size <= 100000) return 20
	if (size <= 500000) return 10
	return 5 // For very large tests
}

// Calculate statistical measures
function calculateStats(durations: number[]) {
	// Sort durations for percentile calculations
	const sorted = [...durations].sort((a, b) => a - b)

	// Calculate mean once to avoid repeating this calculation
	const mean = durations.reduce((a, b) => a + b, 0) / durations.length

	return {
		min: sorted[0],
		max: sorted[sorted.length - 1],
		median: sorted[Math.floor(sorted.length / 2)],
		p95: sorted[Math.floor(sorted.length * 0.95)],
		p99: sorted[Math.floor(sorted.length * 0.99)],
		mean,
		stdDev: Math.sqrt(durations.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / durations.length),
	}
}

// Run performance test for a specific function
function runPerformanceTest(
	name: string,
	fn: (input: string, ...args: any[]) => string,
	input: string,
	iterations: number,
	args: any[] = [],
) {
	console.log(`\nTesting ${name}...`)

	// Pre-warm
	const warmupResult = fn(input, ...args)
	const resultSize = (warmupResult.length / (1024 * 1024)).toFixed(2)
	const reduction = (100 - (warmupResult.length / input.length) * 100).toFixed(2)

	// Measure performance
	const durations: number[] = []

	// Force garbage collection if available (Node.js with --expose-gc flag)
	if (global.gc) {
		global.gc()
	}

	for (let i = 0; i < iterations; i++) {
		const startTime = performance.now()
		fn(input, ...args)
		const endTime = performance.now()
		durations.push(endTime - startTime)

		// Progress indicator
		if (iterations > 10 && i % Math.floor(iterations / 10) === 0) {
			process.stdout.write(".")
		}
	}

	if (iterations > 10) {
		process.stdout.write("\n")
	}

	// Calculate stats
	const stats = calculateStats(durations)

	// Calculate throughput
	const totalSizeProcessed = (input.length * iterations) / (1024 * 1024) // MB
	const totalBenchmarkTime = durations.reduce((a, b) => a + b, 0) / 1000 // seconds
	const averageThroughput = (totalSizeProcessed / totalBenchmarkTime).toFixed(2) // MB/s
	const peakThroughput = (input.length / (1024 * 1024) / (stats.min / 1000)).toFixed(2) // MB/s
	// Add a more stable "reliable throughput" metric based on p95
	const reliableThroughput = (input.length / (1024 * 1024) / (stats.p95 / 1000)).toFixed(2) // MB/s

	// Output metrics
	console.log(`- Time Statistics (in ms):`)
	console.log(`  • Mean: ${stats.mean.toFixed(3)}`)
	console.log(`  • Median: ${stats.median.toFixed(3)}`)
	console.log(`  • Min: ${stats.min.toFixed(3)}`)
	console.log(`  • Max: ${stats.max.toFixed(3)}`)
	console.log(`  • P95: ${stats.p95.toFixed(3)}`)
	console.log(`  • P99: ${stats.p99.toFixed(3)}`)
	console.log(`- Throughput:`)
	console.log(`  • Average: ${averageThroughput} MB/s`)
	console.log(`  • Peak: ${peakThroughput} MB/s`)
	console.log(`  • Reliable (P95): ${reliableThroughput} MB/s`)
	console.log(
		`- Output size: ${resultSize} MB (${reduction}% ${parseFloat(reduction) < 0 ? "increase" : "reduction"})`,
	)

	return {
		stats,
		resultSize,
		reduction,
		averageThroughput,
		peakThroughput,
		reliableThroughput,
	}
}

// Run comparative test between identical runs to measure variance
function runBaselineTest(input: string, iterations: number) {
	console.log("\n=== Baseline Performance Test ===")
	console.log(`Testing with ${(input.length / (1024 * 1024)).toFixed(2)} MB of data`)

	const runs = 5 // Run 5 times for better variance analysis
	const results = []

	for (let i = 0; i < runs; i++) {
		results.push(runPerformanceTest(`Run ${i + 1}`, processCarriageReturns, input, iterations))
	}

	// Calculate average and variance metrics
	const meanTimes = results.map((r) => r.stats.mean)
	const avgMean = meanTimes.reduce((a, b) => a + b, 0) / runs
	const maxVariation = Math.max(...meanTimes.map((t) => Math.abs(((t - avgMean) / avgMean) * 100)))

	const throughputs = results.map((r) => parseFloat(r.peakThroughput))
	const avgThroughput = throughputs.reduce((a, b) => a + b, 0) / runs
	const throughputVariation = Math.max(
		...throughputs.map((t) => Math.abs(((t - avgThroughput) / avgThroughput) * 100)),
	)

	console.log("\n=== Performance Variation Analysis ===")
	console.log(`Mean execution time: ${avgMean.toFixed(3)} ms (±${maxVariation.toFixed(2)}%)`)
	console.log(`Peak throughput: ${avgThroughput.toFixed(2)} MB/s (±${throughputVariation.toFixed(2)}%)`)

	return { results, avgMean, maxVariation, avgThroughput, throughputVariation }
}

// Run benchmark with different data sizes and complexity levels
function runBenchmark() {
	// Define regular test configurations: [size, complexity]
	const standardTestConfigs: [number, "simple" | "medium" | "complex"][] = [
		[10000, "simple"],
		[10000, "complex"],
		[100000, "simple"],
		[100000, "complex"],
		[500000, "complex"], // Large data test
	]

	// Define long line test configurations: [lineLengthKB, updateCount]
	const longLineTestConfigs: [number, number][] = [
		[100, 20], // 100KB line with 20 updates
		[1000, 50], // 1MB line with 50 updates
		[5000, 200], // 5MB line with 200 updates
	]

	// Define high-density CR test configurations: [size]
	const highDensityCRConfigs: number[] = [
		10000, // 10K updates
		100000, // 100K updates
	]

	console.log("=".repeat(80))
	console.log("TERMINAL OUTPUT PROCESSING BENCHMARK")
	console.log("=".repeat(80))

	// Initial warmup to load JIT compiler
	console.log("\nPerforming initial warmup...")
	const warmupData = generateTestData(5000, "complex")
	for (let i = 0; i < 50; i++) {
		processCarriageReturns(warmupData)
		applyRunLengthEncoding(warmupData)
		truncateOutput(warmupData, 500)
	}
	console.log("Warmup complete")

	// Run standard tests
	console.log("\n" + "=".repeat(80))
	console.log("STANDARD TESTS")
	console.log("=".repeat(80))

	for (const [size, complexity] of standardTestConfigs) {
		console.log(`\n${"-".repeat(80)}`)
		console.log(`Testing with ${size} lines, ${complexity} complexity...`)

		// Generate test data
		const startGenTime = performance.now()
		const testData = generateTestData(size, complexity)
		const genTime = performance.now() - startGenTime
		const dataSize = (testData.length / (1024 * 1024)).toFixed(2)

		console.log(`Generated ${dataSize} MB of test data in ${genTime.toFixed(2)}ms`)

		// Count carriage returns for reference
		const carriageReturns = (testData.match(/\r/g) || []).length
		const newLines = (testData.match(/\n/g) || []).length
		console.log(`Test data contains ${carriageReturns} carriage returns and ${newLines} newlines`)

		// Get iteration count based on data size
		const iterations = getIterationCount(size)
		console.log(`Running ${iterations} iterations for each function...`)

		// Test each function
		const lineLimit = 500 // Standard line limit for truncation

		console.log("\n--- Function 1: processCarriageReturns ---")
		runPerformanceTest("processCarriageReturns", processCarriageReturns, testData, iterations)

		console.log("\n--- Function 2: applyRunLengthEncoding ---")
		runPerformanceTest("applyRunLengthEncoding", applyRunLengthEncoding, testData, iterations)

		console.log("\n--- Function 3: truncateOutput ---")
		runPerformanceTest("truncateOutput", truncateOutput, testData, iterations, [lineLimit])

		// Run baseline test to measure variance between identical runs
		runBaselineTest(testData, Math.max(5, Math.floor(iterations / 4)))

		// Test combined pipeline
		console.log("\n--- Combined Pipeline ---")
		runPerformanceTest(
			"Full Pipeline",
			(input) => truncateOutput(applyRunLengthEncoding(processCarriageReturns(input)), lineLimit),
			testData,
			Math.max(3, Math.floor(iterations / 5)),
		)
	}

	// Run long line tests
	console.log("\n" + "=".repeat(80))
	console.log("EXTRA LONG LINE TESTS")
	console.log("=".repeat(80))

	for (const [lineLength, updateCount] of longLineTestConfigs) {
		console.log(`\n${"-".repeat(80)}`)
		console.log(`Testing with ${lineLength}KB single line, ${updateCount} carriage return updates...`)

		// Generate long line test data
		const startGenTime = performance.now()
		const testData = generateLongLineTestData(lineLength, updateCount)
		const genTime = performance.now() - startGenTime
		const dataSize = (testData.length / (1024 * 1024)).toFixed(2)

		console.log(`Generated ${dataSize} MB of long line test data in ${genTime.toFixed(2)}ms`)
		console.log(`Test data contains ${updateCount} carriage returns`)

		// Use fewer iterations for long line tests
		const iterations = Math.max(3, Math.min(10, getIterationCount(lineLength * 100)))
		console.log(`Running ${iterations} iterations...`)

		console.log("\n--- Testing processCarriageReturns with long line ---")
		runPerformanceTest("processCarriageReturns (long line)", processCarriageReturns, testData, iterations)
	}

	// Run high-density carriage return tests
	console.log("\n" + "=".repeat(80))
	console.log("HIGH-DENSITY CARRIAGE RETURN TESTS")
	console.log("=".repeat(80))

	for (const size of highDensityCRConfigs) {
		console.log(`\n${"-".repeat(80)}`)
		console.log(`Testing with ${size} high-density CR updates...`)

		// Generate high-density CR test data
		const startGenTime = performance.now()
		const testData = generateHighDensityCRData(size)
		const genTime = performance.now() - startGenTime
		const dataSize = (testData.length / (1024 * 1024)).toFixed(2)

		console.log(`Generated ${dataSize} MB of high-density CR test data in ${genTime.toFixed(2)}ms`)

		// Use fewer iterations for these intensive tests
		const iterations = Math.max(5, Math.floor(getIterationCount(size) / 2))
		console.log(`Running ${iterations} iterations...`)

		console.log("\n--- Testing processCarriageReturns with high-density CRs ---")
		runPerformanceTest("processCarriageReturns (high-density CR)", processCarriageReturns, testData, iterations)
	}

	console.log("\n" + "=".repeat(80))
	console.log("Benchmark complete")
	console.log("=".repeat(80))
}

// Run the benchmark
runBenchmark()

// To run this benchmark:
// npx tsx src/integrations/misc/__tests__/performance/processCarriageReturns.benchmark.ts

// To run with more accurate timing (with explicit garbage collection):
// node --expose-gc -r tsx/cjs src/integrations/misc/__tests__/performance/processCarriageReturns.benchmark.ts
