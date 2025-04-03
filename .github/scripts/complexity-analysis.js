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

function log(message) {
	console.log(`[Complexity Analysis] ${message}`)
}

function fileExists(filePath) {
	return fs.existsSync(filePath)
}

function extractComplexityMetrics() {
	log("Running ESLint complexity check...")
	try {
		execSync("eslint -c .eslintrc.complexity.json src --ext ts --format json -o complexity-report.json", { stdio: "inherit" })
	} catch (error) {
		// ESLint exits with error if there are any violations, but we want to continue
		log("ESLint completed with violations")
	}

	if (!fileExists("complexity-report.json")) {
		throw new Error("ESLint did not generate complexity report")
	}

	log("Parsing ESLint report...")
	const eslintReport = JSON.parse(fs.readFileSync("complexity-report.json", "utf8"))

	// Get all violations
	const totalViolations = eslintReport.length || 0
	const cognitiveViolations = eslintReport.filter((msg) => msg.ruleId === "sonarjs/cognitive-complexity").length

	log("Running maintainability analysis...")
	const maintainabilityReport = analyzeProject("src/**/*.ts")
	const maintainabilityIndex = maintainabilityReport.summary.averageMaintainabilityIndex

	const metrics = {
		violations: totalViolations,
		cognitiveViolations,
		maintainabilityIndex,
	}

	log("Saving metrics to file...")
	fs.writeFileSync("complexity-metrics.json", JSON.stringify(metrics, null, 2))
	log(`Found ${totalViolations} total violations, ${cognitiveViolations} cognitive complexity violations`)
	log(`Maintainability index: ${maintainabilityIndex.toFixed(2)}`)

	return metrics
}

function compareComplexityMetrics(baseMetrics, currentMetrics) {
	log("Comparing complexity metrics...")

	const comparison = {
		violations: {
			decreased: currentMetrics.violations < baseMetrics.violations,
			diff: Math.abs(currentMetrics.violations - baseMetrics.violations),
		},
		cognitiveComplexity: {
			decreased: currentMetrics.cognitiveViolations < baseMetrics.cognitiveViolations,
			diff: Math.abs(currentMetrics.cognitiveViolations - baseMetrics.cognitiveViolations),
		},
		maintainability: {
			decreased: currentMetrics.maintainabilityIndex < baseMetrics.maintainabilityIndex,
			diff: Math.abs(currentMetrics.maintainabilityIndex - baseMetrics.maintainabilityIndex),
		},
		hasComplexityIncreased:
			currentMetrics.violations > baseMetrics.violations ||
			currentMetrics.cognitiveViolations > baseMetrics.cognitiveViolations ||
			currentMetrics.maintainabilityIndex < baseMetrics.maintainabilityIndex,
	}

	log(`Violations ${comparison.violations.decreased ? "decreased" : "increased"} by ${comparison.violations.diff}`)
	log(
		`Cognitive complexity ${comparison.cognitiveComplexity.decreased ? "decreased" : "increased"} by ${comparison.cognitiveComplexity.diff}`,
	)
	log(
		`Maintainability ${comparison.maintainability.decreased ? "decreased" : "improved"} by ${comparison.maintainability.diff.toFixed(2)}`,
	)

	return comparison
}

function generateReport(baseMetrics, currentMetrics, baseBranch, currentBranch) {
	log("Generating complexity comparison report...")
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

	// Write report to file
	fs.writeFileSync("complexity-report.md", report)

	// Return true if any metrics have degraded
	return {
		hasComplexityIncreased:
			currentMetrics.violations > baseMetrics.violations ||
			currentMetrics.cognitiveViolations > baseMetrics.cognitiveViolations ||
			currentMetrics.maintainabilityIndex < baseMetrics.maintainabilityIndex,
		report,
	}
}

// Main execution
function main() {
	try {
		log("Starting complexity analysis...")
		const metrics = extractComplexityMetrics()
		log("Analysis complete. See complexity-metrics.json for detailed results.")
	} catch (error) {
		log(`Error: ${error.message}`)
		if (error.stack) {
			log("Stack trace:")
			log(error.stack)
		}
		process.exit(1)
	}
}

// Export functions for use by workflow
module.exports = {
	extractComplexityMetrics,
	compareComplexityMetrics,
	generateReport,
}

// If running directly (not required as a module)
if (require.main === module) {
	main()
}
