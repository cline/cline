#!/usr/bin/env node
const escomplex = require("escomplex")
const fs = require("fs")
const path = require("path")
const glob = require("glob")
const { execSync } = require("child_process")

// Maintainability metrics calculation
function calculateMaintainabilityIndex(halsteadVolume, cyclomaticComplexity, sloc) {
	return Math.max(
		0,
		Math.min(100, ((171 - 5.2 * Math.log(halsteadVolume) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(sloc)) * 100) / 171),
	)
}

function analyzeFile(filePath) {
	const content = fs.readFileSync(filePath, "utf8")
	const report = escomplex.analyse(content, {})

	const metrics = {
		path: filePath,
		maintainabilityIndex: 0,
		cyclomaticComplexity: 0,
		sloc: 0,
		functions: [],
	}

	// Calculate metrics for each function
	report.functions.forEach((func) => {
		const mi = calculateMaintainabilityIndex(func.halstead.volume, func.cyclomatic, func.sloc.physical)

		metrics.functions.push({
			name: func.name,
			maintainabilityIndex: mi,
			cyclomaticComplexity: func.cyclomatic,
			sloc: func.sloc.physical,
		})

		// Add to file totals
		metrics.maintainabilityIndex += mi
		metrics.cyclomaticComplexity += func.cyclomatic
		metrics.sloc += func.sloc.physical
	})

	// Average the maintainability index if there are functions
	if (report.functions.length > 0) {
		metrics.maintainabilityIndex /= report.functions.length
	}

	return metrics
}

function analyzeProject(pattern) {
	const files = glob.sync(pattern)
	const results = {
		files: [],
		summary: {
			totalFiles: 0,
			averageMaintainabilityIndex: 0,
			totalCyclomaticComplexity: 0,
			totalSLOC: 0,
		},
	}

	files.forEach((file) => {
		try {
			const metrics = analyzeFile(file)
			results.files.push(metrics)

			results.summary.totalFiles++
			results.summary.averageMaintainabilityIndex += metrics.maintainabilityIndex
			results.summary.totalCyclomaticComplexity += metrics.cyclomaticComplexity
			results.summary.totalSLOC += metrics.sloc
		} catch (error) {
			console.error(`Error analyzing ${file}:`, error.message)
		}
	})

	if (results.summary.totalFiles > 0) {
		results.summary.averageMaintainabilityIndex /= results.summary.totalFiles
	}

	return results
}

// Branch comparison functionality
function getCurrentBranch() {
	return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim()
}

function analyzeBranch(branchName) {
	// Checkout the branch
	execSync(`git checkout ${branchName}`, { stdio: "inherit" })

	// Run ESLint complexity check
	execSync("npm run lint:complexity", { stdio: "inherit", cwd: process.cwd() })
	const eslintReport = JSON.parse(fs.readFileSync("complexity-report.json", "utf8"))

	// Get all violations (now all are warnings from .eslintrc.complexity.json)
	const totalViolations = eslintReport.length || 0
	const cognitiveViolations = eslintReport.filter((msg) => msg.ruleId === "sonarjs/cognitive-complexity").length

	// Run maintainability analysis
	const maintainabilityReport = analyzeProject("src/**/*.ts")
	const maintainabilityIndex = maintainabilityReport.summary.averageMaintainabilityIndex

	return {
		violations: totalViolations,
		cognitiveViolations,
		maintainabilityIndex,
	}
}

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

// If running directly (not required as a module)
if (require.main === module) {
	main()
}
