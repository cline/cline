/**
 * Script to find missing translations in locale files
 *
 * Usage:
 *   node scripts/find-missing-translations.js [options]
 *
 * Options:
 *   --locale=<locale>   Only check a specific locale (e.g. --locale=fr)
 *   --file=<file>       Only check a specific file (e.g. --file=chat.json)
 *   --area=<area>       Only check a specific area (core, webview, or both)
 *   --help              Show this help message
 */

const fs = require("fs")
const path = require("path")

// Process command line arguments
const args = process.argv.slice(2).reduce(
	(acc, arg) => {
		if (arg === "--help") {
			acc.help = true
		} else if (arg.startsWith("--locale=")) {
			acc.locale = arg.split("=")[1]
		} else if (arg.startsWith("--file=")) {
			acc.file = arg.split("=")[1]
		} else if (arg.startsWith("--area=")) {
			acc.area = arg.split("=")[1]
			// Validate area value
			if (!["core", "webview", "both"].includes(acc.area)) {
				console.error(`Error: Invalid area '${acc.area}'. Must be 'core', 'webview', or 'both'.`)
				process.exit(1)
			}
		}
		return acc
	},
	{ area: "both" },
) // Default to checking both areas

// Show help if requested
if (args.help) {
	console.log(`
Find Missing Translations

A utility script to identify missing translations across locale files.
Compares non-English locale files to the English ones to find any missing keys.

Usage:
  node scripts/find-missing-translations.js [options]

Options:
  --locale=<locale>   Only check a specific locale (e.g. --locale=fr)
  --file=<file>       Only check a specific file (e.g. --file=chat.json)
  --area=<area>       Only check a specific area (core, webview, or both)
                      'core' = Backend (src/i18n/locales)
                      'webview' = Frontend UI (webview-ui/src/i18n/locales)
                      'both' = Check both areas (default)
  --help              Show this help message

Output:
  - Generates a report of missing translations for each area
  `)
	process.exit(0)
}

// Paths to the locales directories
const LOCALES_DIRS = {
	core: path.join(__dirname, "../src/i18n/locales"),
	webview: path.join(__dirname, "../webview-ui/src/i18n/locales"),
}

// Determine which areas to check based on args
const areasToCheck = args.area === "both" ? ["core", "webview"] : [args.area]

// Recursively find all keys in an object
function findKeys(obj, parentKey = "") {
	let keys = []

	for (const [key, value] of Object.entries(obj)) {
		const currentKey = parentKey ? `${parentKey}.${key}` : key

		if (typeof value === "object" && value !== null) {
			// If value is an object, recurse
			keys = [...keys, ...findKeys(value, currentKey)]
		} else {
			// If value is a primitive, add the key
			keys.push(currentKey)
		}
	}

	return keys
}

// Get value at a dotted path in an object
function getValueAtPath(obj, path) {
	const parts = path.split(".")
	let current = obj

	for (const part of parts) {
		if (current === undefined || current === null) {
			return undefined
		}
		current = current[part]
	}

	return current
}

// Function to check translations for a specific area
function checkAreaTranslations(area) {
	const LOCALES_DIR = LOCALES_DIRS[area]

	// Get all locale directories (or filter to the specified locale)
	const allLocales = fs.readdirSync(LOCALES_DIR).filter((item) => {
		const stats = fs.statSync(path.join(LOCALES_DIR, item))
		return stats.isDirectory() && item !== "en" // Exclude English as it's our source
	})

	// Filter to the specified locale if provided
	const locales = args.locale ? allLocales.filter((locale) => locale === args.locale) : allLocales

	if (args.locale && locales.length === 0) {
		console.error(`Error: Locale '${args.locale}' not found in ${LOCALES_DIR}`)
		process.exit(1)
	}

	console.log(
		`\n${area === "core" ? "BACKEND" : "FRONTEND"} - Checking ${locales.length} non-English locale(s): ${locales.join(", ")}`,
	)

	// Get all English JSON files
	const englishDir = path.join(LOCALES_DIR, "en")
	let englishFiles = fs.readdirSync(englishDir).filter((file) => file.endsWith(".json") && !file.startsWith("."))

	// Filter to the specified file if provided
	if (args.file) {
		if (!englishFiles.includes(args.file)) {
			console.error(`Error: File '${args.file}' not found in ${englishDir}`)
			process.exit(1)
		}
		englishFiles = englishFiles.filter((file) => file === args.file)
	}

	// Load file contents
	let englishFileContents

	try {
		englishFileContents = englishFiles.map((file) => ({
			name: file,
			content: JSON.parse(fs.readFileSync(path.join(englishDir, file), "utf8")),
		}))
	} catch (e) {
		console.error(`Error: File '${englishDir}' is not a valid JSON file`)
		process.exit(1)
	}

	console.log(
		`Checking ${englishFileContents.length} translation file(s): ${englishFileContents.map((f) => f.name).join(", ")}`,
	)

	// Results object to store missing translations
	const missingTranslations = {}

	// For each locale, check for missing translations
	for (const locale of locales) {
		missingTranslations[locale] = {}

		for (const { name, content: englishContent } of englishFileContents) {
			const localeFilePath = path.join(LOCALES_DIR, locale, name)

			// Check if the file exists in the locale
			if (!fs.existsSync(localeFilePath)) {
				missingTranslations[locale][name] = { file: "File is missing entirely" }
				continue
			}

			// Load the locale file
			let localeContent

			try {
				localeContent = JSON.parse(fs.readFileSync(localeFilePath, "utf8"))
			} catch (e) {
				console.error(`Error: File '${localeFilePath}' is not a valid JSON file`)
				process.exit(1)
			}

			// Find all keys in the English file
			const englishKeys = findKeys(englishContent)

			// Check for missing keys in the locale file
			const missingKeys = []

			for (const key of englishKeys) {
				const englishValue = getValueAtPath(englishContent, key)
				const localeValue = getValueAtPath(localeContent, key)

				if (localeValue === undefined) {
					missingKeys.push({
						key,
						englishValue,
					})
				}
			}

			if (missingKeys.length > 0) {
				missingTranslations[locale][name] = missingKeys
			}
		}
	}

	return { missingTranslations, hasMissingTranslations: outputResults(missingTranslations, area) }
}

// Function to output results for an area
function outputResults(missingTranslations, area) {
	let hasMissingTranslations = false

	console.log(`\n${area === "core" ? "BACKEND" : "FRONTEND"} Missing Translations Report:\n`)

	for (const [locale, files] of Object.entries(missingTranslations)) {
		if (Object.keys(files).length === 0) {
			console.log(`✅ ${locale}: No missing translations`)
			continue
		}

		hasMissingTranslations = true
		console.log(`📝 ${locale}:`)

		for (const [fileName, missingItems] of Object.entries(files)) {
			if (missingItems.file) {
				console.log(`  - ${fileName}: ${missingItems.file}`)
				continue
			}

			console.log(`  - ${fileName}: ${missingItems.length} missing translations`)

			for (const { key, englishValue } of missingItems) {
				console.log(`      ${key}: "${englishValue}"`)
			}
		}

		console.log("")
	}

	return hasMissingTranslations
}

// Main function to find missing translations
function findMissingTranslations() {
	try {
		console.log("Starting translation check...")

		let anyAreaMissingTranslations = false

		// Check each requested area
		for (const area of areasToCheck) {
			const { hasMissingTranslations } = checkAreaTranslations(area)
			anyAreaMissingTranslations = anyAreaMissingTranslations || hasMissingTranslations
		}

		// Summary
		if (!anyAreaMissingTranslations) {
			console.log("\n✅ All translations are complete across all checked areas!")
		} else {
			console.log("\n✏️  To add missing translations:")
			console.log("1. Add the missing keys to the corresponding locale files")
			console.log("2. Translate the English values to the appropriate language")
			console.log("3. Run this script again to verify all translations are complete")
			// Exit with error code to fail CI checks
			process.exit(1)
		}
	} catch (error) {
		console.error("Error:", error.message)
		console.error(error.stack)
		process.exit(1)
	}
}

// Run the main function
findMissingTranslations()
