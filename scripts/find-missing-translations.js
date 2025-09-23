/**
 * Script to find missing translations in locale files
 *
 * Usage:
 *   node scripts/find-missing-translations.js [options]
 *
 * Options:
 *   --locale=<locale>   Only check a specific locale (e.g. --locale=fr)
 *   --file=<file>       Only check a specific file (e.g. --file=chat.json)
 *   --area=<area>       Only check a specific area (core, webview, package-nls, or all)
 *   --help              Show this help message
 */

const path = require("path")
const { promises: fs } = require("fs")

const readFile = fs.readFile
const readdir = fs.readdir
const stat = fs.stat

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
			if (!["core", "webview", "package-nls", "all"].includes(acc.area)) {
				console.error(`Error: Invalid area '${acc.area}'. Must be 'core', 'webview', 'package-nls', or 'all'.`)
				process.exit(1)
			}
		}
		return acc
	},
	{ area: "all" },
) // Default to checking all areas

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
  --area=<area>       Only check a specific area (core, webview, package-nls, or all)
                      'core' = Backend (src/i18n/locales)
                      'webview' = Frontend UI (webview-ui/src/i18n/locales)
                      'package-nls' = VSCode package.nls.json files
                      'all' = Check all areas (default)
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
const areasToCheck = args.area === "all" ? ["core", "webview", "package-nls"] : [args.area]

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

// Shared utility to safely parse JSON files with error handling
async function parseJsonFile(filePath) {
	try {
		const content = await readFile(filePath, "utf8")
		return JSON.parse(content)
	} catch (error) {
		if (error.code === "ENOENT") {
			return null // File doesn't exist
		}
		throw new Error(`Error parsing JSON file '${filePath}': ${error.message}`)
	}
}

// Validate that a JSON object has a flat structure (no nested objects)
function validateFlatStructure(obj, filePath) {
	for (const [key, value] of Object.entries(obj)) {
		if (typeof value === "object" && value !== null) {
			console.error(`Error: ${filePath} should be a flat JSON structure. Found nested object at key '${key}'`)
			process.exit(1)
		}
	}
}

// Function to check translations for a specific area
async function checkAreaTranslations(area) {
	const LOCALES_DIR = LOCALES_DIRS[area]

	// Get all locale directories (or filter to the specified locale)
	const dirContents = await readdir(LOCALES_DIR)
	const allLocales = await Promise.all(
		dirContents.map(async (item) => {
			const stats = await stat(path.join(LOCALES_DIR, item))
			return stats.isDirectory() && item !== "en" ? item : null
		}),
	)
	const filteredLocales = allLocales.filter(Boolean)

	// Filter to the specified locale if provided
	const locales = args.locale ? filteredLocales.filter((locale) => locale === args.locale) : filteredLocales

	if (args.locale && locales.length === 0) {
		console.error(`Error: Locale '${args.locale}' not found in ${LOCALES_DIR}`)
		process.exit(1)
	}

	console.log(
		`\n${area === "core" ? "BACKEND" : "FRONTEND"} - Checking ${locales.length} non-English locale(s): ${locales.join(", ")}`,
	)

	// Get all English JSON files
	const englishDir = path.join(LOCALES_DIR, "en")
	const englishDirContents = await readdir(englishDir)
	let englishFiles = englishDirContents.filter((file) => file.endsWith(".json") && !file.startsWith("."))

	// Filter to the specified file if provided
	if (args.file) {
		if (!englishFiles.includes(args.file)) {
			console.error(`Error: File '${args.file}' not found in ${englishDir}`)
			process.exit(1)
		}
		englishFiles = englishFiles.filter((file) => file === args.file)
	}

	// Load file contents in parallel
	const englishFileContents = await Promise.all(
		englishFiles.map(async (file) => {
			const filePath = path.join(englishDir, file)
			const content = await parseJsonFile(filePath)
			if (!content) {
				console.error(`Error: Could not read file '${filePath}'`)
				process.exit(1)
			}
			return { name: file, content }
		}),
	)

	console.log(
		`Checking ${englishFileContents.length} translation file(s): ${englishFileContents.map((f) => f.name).join(", ")}`,
	)

	// Precompute English keys per file
	const englishFileKeys = new Map(englishFileContents.map((f) => [f.name, findKeys(f.content)]))

	// Results object to store missing translations
	const missingTranslations = {}

	// Process all locales in parallel
	await Promise.all(
		locales.map(async (locale) => {
			missingTranslations[locale] = {}

			// Process all files for this locale in parallel
			await Promise.all(
				englishFileContents.map(async ({ name, content: englishContent }) => {
					const localeFilePath = path.join(LOCALES_DIR, locale, name)

					// Check if the file exists in the locale
					const localeContent = await parseJsonFile(localeFilePath)
					if (!localeContent) {
						missingTranslations[locale][name] = { file: "File is missing entirely" }
						return
					}

					// Find all keys in the English file
					const englishKeys = englishFileKeys.get(name) || []

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
				}),
			)
		}),
	)

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

// Function to check package.nls.json translations
async function checkPackageNlsTranslations() {
	const SRC_DIR = path.join(__dirname, "../src")

	// Read the base package.nls.json file
	const baseFilePath = path.join(SRC_DIR, "package.nls.json")
	const baseContent = await parseJsonFile(baseFilePath)

	if (!baseContent) {
		console.warn(`Warning: Base package.nls.json not found at ${baseFilePath} - skipping package.nls checks`)
		return { missingTranslations: {}, hasMissingTranslations: false }
	}

	// Validate that the base file has a flat structure
	validateFlatStructure(baseContent, baseFilePath)

	// Get all package.nls.*.json files
	const srcDirContents = await readdir(SRC_DIR)
	const nlsFiles = srcDirContents
		.filter((file) => file.startsWith("package.nls.") && file.endsWith(".json"))
		.filter((file) => file !== "package.nls.json") // Exclude the base file

	// Filter to the specified locale if provided
	const filesToCheck = args.locale
		? nlsFiles.filter((file) => {
				const locale = file.replace("package.nls.", "").replace(".json", "")
				return locale === args.locale
			})
		: nlsFiles

	if (args.locale && filesToCheck.length === 0) {
		console.error(`Error: Locale '${args.locale}' not found in package.nls files`)
		process.exit(1)
	}

	console.log(
		`\nPACKAGE.NLS - Checking ${filesToCheck.length} locale file(s): ${filesToCheck.map((f) => f.replace("package.nls.", "").replace(".json", "")).join(", ")}`,
	)
	console.log(`Checking against base package.nls.json with ${Object.keys(baseContent).length} keys`)

	// Results object to store missing translations
	const missingTranslations = {}

	// Get all keys from the base file (package.nls files are flat, not nested)
	const baseKeys = Object.keys(baseContent)

	// Process all locale files in parallel
	await Promise.all(
		filesToCheck.map(async (file) => {
			const locale = file.replace("package.nls.", "").replace(".json", "")
			const localeFilePath = path.join(SRC_DIR, file)

			const localeContent = await parseJsonFile(localeFilePath)
			if (!localeContent) {
				console.error(`Error: Could not read file '${localeFilePath}'`)
				process.exit(1)
			}

			// Validate that the locale file has a flat structure
			validateFlatStructure(localeContent, localeFilePath)

			// Check for missing keys
			const missingKeys = []

			for (const key of baseKeys) {
				const baseValue = baseContent[key]
				const localeValue = localeContent[key]

				if (localeValue === undefined) {
					missingKeys.push({
						key,
						englishValue: baseValue,
					})
				}
			}

			if (missingKeys.length > 0) {
				missingTranslations[locale] = {
					"package.nls.json": missingKeys,
				}
			}
		}),
	)

	return { missingTranslations, hasMissingTranslations: outputPackageNlsResults(missingTranslations) }
}

// Function to output package.nls results
function outputPackageNlsResults(missingTranslations) {
	let hasMissingTranslations = false

	console.log(`\nPACKAGE.NLS Missing Translations Report:\n`)

	for (const [locale, files] of Object.entries(missingTranslations)) {
		if (Object.keys(files).length === 0) {
			console.log(`✅ ${locale}: No missing translations`)
			continue
		}

		hasMissingTranslations = true
		console.log(`📝 ${locale}:`)

		for (const [fileName, missingItems] of Object.entries(files)) {
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
async function findMissingTranslations() {
	try {
		console.log("Starting translation check...")

		let anyAreaMissingTranslations = false

		// Check each requested area
		for (const area of areasToCheck) {
			if (area === "package-nls") {
				const { hasMissingTranslations } = await checkPackageNlsTranslations()
				anyAreaMissingTranslations = anyAreaMissingTranslations || hasMissingTranslations
			} else {
				const { hasMissingTranslations } = await checkAreaTranslations(area)
				anyAreaMissingTranslations = anyAreaMissingTranslations || hasMissingTranslations
			}
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
