import * as fs from "fs"

/**
 * Generate a markdown report from evaluation results
 * @param summary Overall summary
 * @param benchmarkReports Benchmark-specific reports
 * @param outputPath Output file path
 */
export function generateMarkdownReport(summary: any, benchmarkReports: Record<string, any>, outputPath: string): void {
	let markdown = `# Cline Evaluation Report\n\n`

	// Generate summary section
	markdown += `## Summary\n\n`
	markdown += `- **Total Runs:** ${summary.runs}\n`
	markdown += `- **Benchmarks:** ${summary.benchmarks.join(", ")}\n`
	markdown += `- **Total Tasks:** ${summary.tasks}\n`
	markdown += `- **Task Success Rate:** ${(summary.successRate * 100).toFixed(2)}%\n`
	markdown += `- **Total Tests:** ${summary.totalTests}\n`
	markdown += `- **Tests Passed:** ${summary.totalTestsPassed}\n`
	markdown += `- **Tests Failed:** ${summary.totalTestsFailed}\n`
	markdown += `- **Test Success Rate:** ${(summary.testSuccessRate * 100).toFixed(2)}%\n`
	markdown += `- **Average Tokens:** ${Math.round(summary.averageTokens)}\n`
	markdown += `- **Average Cost:** $${summary.averageCost.toFixed(4)}\n`
	markdown += `- **Average Duration:** ${(summary.averageDuration / 1000).toFixed(2)}s\n`
	markdown += `- **Total Tool Calls:** ${summary.totalToolCalls}\n`
	markdown += `- **Tool Success Rate:** ${(summary.toolSuccessRate * 100).toFixed(2)}%\n\n`

	// Generate tool usage section
	markdown += `## Tool Usage\n\n`
	markdown += `| Tool | Calls | Failures | Success Rate |\n`
	markdown += `| ---- | ----- | -------- | ------------ |\n`

	for (const [toolName, metrics] of Object.entries(summary.toolUsage)) {
		const calls = (metrics as any).calls
		const failures = (metrics as any).failures
		const successRate = calls > 0 ? (1 - failures / calls) * 100 : 100

		markdown += `| ${toolName} | ${calls} | ${failures} | ${successRate.toFixed(2)}% |\n`
	}

	// Generate benchmark results section
	markdown += `\n## Benchmark Results\n\n`

	for (const [benchmark, report] of Object.entries(benchmarkReports)) {
		markdown += `### ${benchmark}\n\n`
		markdown += `- **Runs:** ${report.runs}\n`
		markdown += `- **Tasks:** ${report.tasks}\n`
		markdown += `- **Task Success Rate:** ${(report.successRate * 100).toFixed(2)}%\n`
		markdown += `- **Total Tests:** ${report.totalTests}\n`
		markdown += `- **Tests Passed:** ${report.totalTestsPassed}\n`
		markdown += `- **Tests Failed:** ${report.totalTestsFailed}\n`
		markdown += `- **Test Success Rate:** ${(report.testSuccessRate * 100).toFixed(2)}%\n`
		markdown += `- **Average Tokens:** ${Math.round(report.averageTokens)}\n`
		markdown += `- **Average Cost:** $${report.averageCost.toFixed(4)}\n`
		markdown += `- **Average Duration:** ${(report.averageDuration / 1000).toFixed(2)}s\n\n`
	}

	// Add charts using Mermaid
	markdown += `## Charts\n\n`

	// Success rate by benchmark chart
	markdown += `### Success Rate by Benchmark\n\n`
	markdown += "```mermaid\n"
	markdown += "graph TD\n"
	markdown += "  title[Success Rate by Benchmark]\n"
	markdown += "  style title fill:none,stroke:none\n\n"

	for (const [benchmark, report] of Object.entries(benchmarkReports)) {
		const successRate = (report.successRate * 100).toFixed(2)
		markdown += `  ${benchmark}[${benchmark}: ${successRate}%]\n`
	}

	markdown += "```\n\n"

	// Add timestamp
	markdown += `\n\n---\n\nReport generated on ${new Date().toISOString()}\n`

	// Write markdown to file
	fs.writeFileSync(outputPath, markdown)
}
