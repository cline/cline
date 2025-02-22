const escomplex = require("escomplex")
const fs = require("fs")
const path = require("path")
const glob = require("glob")

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

// Analyze TypeScript files in src directory
const results = analyzeProject("src/**/*.ts")

// Write results to file
fs.writeFileSync("maintainability-report.json", JSON.stringify(results, null, 2))

// Log summary
console.log("Analysis Summary:")
console.log("Total Files:", results.summary.totalFiles)
console.log("Average Maintainability Index:", results.summary.averageMaintainabilityIndex.toFixed(2))
console.log("Total Cyclomatic Complexity:", results.summary.totalCyclomaticComplexity)
console.log("Total SLOC:", results.summary.totalSLOC)
