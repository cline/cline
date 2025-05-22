/* eslint-disable @typescript-eslint/no-unsafe-function-type */

// node --expose-gc --import tsx src/core/assistant-message/__tests__/parseAssistantMessageBenchmark.ts

import { performance } from "perf_hooks"
import { parseAssistantMessage as parseAssistantMessageV1 } from "../parseAssistantMessage"
import { parseAssistantMessageV2 } from "../parseAssistantMessageV2"

const formatNumber = (num: number): string => {
	return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

const measureExecutionTime = (fn: Function, input: string, iterations: number = 1000): number => {
	for (let i = 0; i < 10; i++) {
		fn(input)
	}

	const start = performance.now()

	for (let i = 0; i < iterations; i++) {
		fn(input)
	}

	const end = performance.now()
	return (end - start) / iterations // Average time per iteration in ms.
}

const measureMemoryUsage = (
	fn: Function,
	input: string,
	iterations: number = 100,
): { heapUsed: number; heapTotal: number } => {
	if (global.gc) {
		// Force garbage collection if available.
		global.gc()
	} else {
		console.warn("No garbage collection hook! Run with --expose-gc for more accurate memory measurements.")
	}

	const initialMemory = process.memoryUsage()

	for (let i = 0; i < iterations; i++) {
		fn(input)
	}

	const finalMemory = process.memoryUsage()

	return {
		heapUsed: (finalMemory.heapUsed - initialMemory.heapUsed) / iterations,
		heapTotal: (finalMemory.heapTotal - initialMemory.heapTotal) / iterations,
	}
}

const testCases = [
	{
		name: "Simple text message",
		input: "This is a simple text message without any tool uses.",
	},
	{
		name: "Message with a simple tool use",
		input: "Let's read a file: <read_file><path>src/file.ts</path></read_file>",
	},
	{
		name: "Message with a complex tool use (write_to_file)",
		input: "<write_to_file><path>src/file.ts</path><content>\nfunction example() {\n  // This has XML-like content: </content>\n  return true;\n}\n</content><line_count>5</line_count></write_to_file>",
	},
	{
		name: "Message with multiple tool uses",
		input: "First file: <read_file><path>src/file1.ts</path></read_file>\nSecond file: <read_file><path>src/file2.ts</path></read_file>\nLet's write a new file: <write_to_file><path>src/file3.ts</path><content>\nexport function newFunction() {\n  return 'Hello world';\n}\n</content><line_count>3</line_count></write_to_file>",
	},
	{
		name: "Large message with repeated tool uses",
		input: Array(50)
			.fill(
				'<read_file><path>src/file.ts</path></read_file>\n<write_to_file><path>output.ts</path><content>console.log("hello");</content><line_count>1</line_count></write_to_file>',
			)
			.join("\n"),
	},
]

const runBenchmark = () => {
	const maxNameLength = testCases.reduce((max, testCase) => Math.max(max, testCase.name.length), 0)
	const namePadding = maxNameLength + 2

	console.log(
		`| ${"Test Case".padEnd(namePadding)} | V1 Time (ms) | V2 Time (ms) | V1/V2 Ratio | V1 Heap (bytes) | V2 Heap (bytes) |`,
	)
	console.log(
		`| ${"-".repeat(namePadding)} | ------------ | ------------ | ----------- | ---------------- | ---------------- |`,
	)

	for (const testCase of testCases) {
		const v1Time = measureExecutionTime(parseAssistantMessageV1, testCase.input)
		const v2Time = measureExecutionTime(parseAssistantMessageV2, testCase.input)
		const timeRatio = v1Time / v2Time

		const v1Memory = measureMemoryUsage(parseAssistantMessageV1, testCase.input)
		const v2Memory = measureMemoryUsage(parseAssistantMessageV2, testCase.input)

		console.log(
			`| ${testCase.name.padEnd(namePadding)} | ` +
				`${v1Time.toFixed(4).padStart(12)} | ` +
				`${v2Time.toFixed(4).padStart(12)} | ` +
				`${timeRatio.toFixed(2).padStart(11)} | ` +
				`${formatNumber(Math.round(v1Memory.heapUsed)).padStart(16)} | ` +
				`${formatNumber(Math.round(v2Memory.heapUsed)).padStart(16)} |`,
		)
	}
}

runBenchmark()
