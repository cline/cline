#!/usr/bin/env node
const fs = require("fs")
const { execSync } = require("child_process")

// Get current branch name
function getCurrentBranch() {
	return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim()
}

// Analyze a specific branch and return its complexity metrics
function analyzeBranch(branchName) {
	// Checkout the branch
	execSync(`git checkout ${branchName}`, { stdio: "inherit" })

	// Run ESLint complexity check from root directory
	execSync("npm run lint:complexity", { stdio: "inherit", cwd: process.cwd() })
	const eslintReport = JSON.parse(fs.readFileSync("complexity-report.json", "utf8"))

	// Get complexity violations
	const totalViolations = eslintReport.length || 0
	const cognitiveViolations = eslintReport.filter((msg) => msg.ruleId === "sonarjs/cognitive-complexity").length

	// Run maintainability analysis
	execSync("node .github/scripts/complexity-analysis.js", { stdio: "inherit" })
	const maintainabilityReport = JSON.parse(fs.readFileSync("maintainability-report.json", "utf8"))
	const maintainabilityIndex = maintainabilityReport.summary.averageMaintainabilityIndex

	return {
		violations: totalViolations,
		cognitiveViolations,
		maintainabilityIndex,
	}
}

// Generate a report comparing two sets of metrics
function generateReport(baseMetrics, currentMetrics, baseBranch, currentBranch) {
	const getStatus = (base, current, inverse = false) => {
		if (inverse) {
			return current < base ? "⚠️" : "✅"
		}
		return current > base ? "⚠️" : "✅"
	}

	const report = [
		"### Code Complexity Analysis Report",
		"",
		`Comparing '${currentBranch}' with '${baseBranch}'`,
		"",
		"| Metric | Base Branch | Current Branch | Status |",
		"|--------|-------------|----------------|---------|",
		`| ESLint Complexity Violations | ${baseMetrics.violations} | ${currentMetrics.violations} | ${getStatus(baseMetrics.violations, currentMetrics.violations)} |`,
		`| Cognitive Complexity Violations | ${baseMetrics.cognitiveViolations} | ${currentMetrics.cognitiveViolations} | ${getStatus(baseMetrics.cognitiveViolations, currentMetrics.cognitiveViolations)} |`,
		`| Maintainability Index | ${baseMetrics.maintainabilityIndex.toFixed(2)} | ${currentMetrics.maintainabilityIndex.toFixed(2)} | ${getStatus(baseMetrics.maintainabilityIndex, currentMetrics.maintainabilityIndex, true)} |`,
		"",
		"#### Legend",
		"- ✅ No significant increase in complexity",
		"- ⚠️ Complexity has increased",
	].join("\n")

	// In CI, write to file for PR comment
	if (process.env.GITHUB_ACTIONS) {
		fs.writeFileSync("complexity-report.md", report)
	} else {
		console.log(report)
	}

	// Return true if any metrics have degraded
	return (
		currentMetrics.violations > baseMetrics.violations ||
		currentMetrics.cognitiveViolations > baseMetrics.cognitiveViolations ||
		currentMetrics.maintainabilityIndex < baseMetrics.maintainabilityIndex
	)
}

// Main execution
function main() {
	let currentBranch, baseBranch

	// Determine if running in GitHub Actions or locally
	if (process.env.GITHUB_ACTIONS) {
		baseBranch = process.env.GITHUB_BASE_REF
		currentBranch = process.env.GITHUB_HEAD_REF
		if (!baseBranch || !currentBranch) {
			console.error("Required GitHub environment variables not found")
			process.exit(1)
		}
	} else {
		currentBranch = getCurrentBranch()
		baseBranch = process.argv[2] || "main"
	}

	console.log(`Comparing complexity metrics between '${currentBranch}' and '${baseBranch}'`)

	// Store current branch name to return to it
	const originalBranch = currentBranch

	try {
		// Fetch the base branch
		execSync(`git fetch origin ${baseBranch}`, { stdio: "inherit" })

		// Analyze base branch
		console.log("\nAnalyzing base branch...")
		const baseMetrics = analyzeBranch(`origin/${baseBranch}`)

		// Analyze current/PR branch
		console.log("\nAnalyzing current branch...")
		const currentMetrics = analyzeBranch(originalBranch)

		// Generate report
		console.log("\nGenerating report...")
		const hasComplexityIncreased = generateReport(baseMetrics, currentMetrics, baseBranch, currentBranch)

		// Set output for GitHub Actions if in CI
		if (process.env.GITHUB_ACTIONS) {
			fs.appendFileSync(process.env.GITHUB_OUTPUT, `complexity_increased=${hasComplexityIncreased}\n`)
		}

		if (hasComplexityIncreased) {
			console.log("\n⚠️ Code complexity has increased")
		} else {
			console.log("\n✅ Code complexity is stable or has improved")
		}
	} catch (error) {
		console.error("Error:", error.message)
		process.exit(1)
	} finally {
		// Always return to the original branch
		execSync(`git checkout ${originalBranch}`, { stdio: "inherit" })
	}
}

main()
