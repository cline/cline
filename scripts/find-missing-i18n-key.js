const fs = require("fs")
const path = require("path")

// Parse command-line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
	if (arg === "--help") {
		acc.help = true
	} else if (arg.startsWith("--locale=")) {
		acc.locale = arg.split("=")[1]
	} else if (arg.startsWith("--file=")) {
		acc.file = arg.split("=")[1]
	}
	return acc
}, {})

// Display help information
if (args.help) {
	console.log(`
Find missing i18n translations

A useful script to identify whether the i18n keys used in component files exist in all language files.

Usage:
  node scripts/find-missing-i18n-key.js [options]

Options:
  --locale=<locale>   Only check a specific language (e.g., --locale=de)
  --file=<file>       Only check a specific file (e.g., --file=chat.json)
  --help              Display help information

Output:
  - Generate a report of missing translations
  `)
	process.exit(0)
}

// Directory to traverse
const TARGET_DIR = path.join(__dirname, "../webview-ui/src/components")
const LOCALES_DIR = path.join(__dirname, "../webview-ui/src/i18n/locales")

// Regular expressions to match i18n keys
const i18nPatterns = [
	/{t\("([^"]+)"\)}/g, // Match {t("key")} format
	/i18nKey="([^"]+)"/g, // Match i18nKey="key" format
	/t\("([a-zA-Z][a-zA-Z0-9_]*[:.][a-zA-Z0-9_.]+)"\)/g, // Match t("key") format, where key contains a colon or dot
]

// Get all language directories
function getLocaleDirs() {
	const allLocales = fs.readdirSync(LOCALES_DIR).filter((file) => {
		const stats = fs.statSync(path.join(LOCALES_DIR, file))
		return stats.isDirectory() // Do not exclude any language directories
	})

	// Filter to a specific language if specified
	return args.locale ? allLocales.filter((locale) => locale === args.locale) : allLocales
}

// Get the value from JSON by path
function getValueByPath(obj, path) {
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

// Check if the key exists in all language files, return a list of missing language files
function checkKeyInLocales(key, localeDirs) {
	const [file, ...pathParts] = key.split(":")
	const jsonPath = pathParts.join(".")

	const missingLocales = []

	localeDirs.forEach((locale) => {
		const filePath = path.join(LOCALES_DIR, locale, `${file}.json`)
		if (!fs.existsSync(filePath)) {
			missingLocales.push(`${locale}/${file}.json`)
			return
		}

		const json = JSON.parse(fs.readFileSync(filePath, "utf8"))
		if (getValueByPath(json, jsonPath) === undefined) {
			missingLocales.push(`${locale}/${file}.json`)
		}
	})

	return missingLocales
}

// Recursively traverse the directory
function findMissingI18nKeys() {
	const localeDirs = getLocaleDirs()
	const results = []

	function walk(dir) {
		const files = fs.readdirSync(dir)

		for (const file of files) {
			const filePath = path.join(dir, file)
			const stat = fs.statSync(filePath)

			// Exclude test files
			if (filePath.includes(".test.")) continue

			if (stat.isDirectory()) {
				walk(filePath) // Recursively traverse subdirectories
			} else if (stat.isFile() && [".ts", ".tsx", ".js", ".jsx"].includes(path.extname(filePath))) {
				const content = fs.readFileSync(filePath, "utf8")

				// Match all i18n keys
				for (const pattern of i18nPatterns) {
					let match
					while ((match = pattern.exec(content)) !== null) {
						const key = match[1]
						const missingLocales = checkKeyInLocales(key, localeDirs)
						if (missingLocales.length > 0) {
							results.push({
								key,
								missingLocales,
								file: path.relative(TARGET_DIR, filePath),
							})
						}
					}
				}
			}
		}
	}

	walk(TARGET_DIR)
	return results
}

// Execute and output the results
function main() {
	try {
		const localeDirs = getLocaleDirs()
		if (args.locale && localeDirs.length === 0) {
			console.error(`Error: Language '${args.locale}' not found in ${LOCALES_DIR}`)
			process.exit(1)
		}

		console.log(`Checking ${localeDirs.length} non-English languages: ${localeDirs.join(", ")}`)

		const missingKeys = findMissingI18nKeys()

		if (missingKeys.length === 0) {
			console.log("\n✅ All i18n keys are present!")
			return
		}

		console.log("\nMissing i18n keys:\n")
		missingKeys.forEach(({ key, missingLocales, file }) => {
			console.log(`File: ${file}`)
			console.log(`Key: ${key}`)
			console.log("Missing in:")
			missingLocales.forEach((file) => console.log(`  - ${file}`))
			console.log("-------------------")
		})

		// Exit code 1 indicates missing keys
		process.exit(1)
	} catch (error) {
		console.error("Error:", error.message)
		console.error(error.stack)
		process.exit(1)
	}
}

main()
