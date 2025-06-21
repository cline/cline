#!/usr/bin/env node

/**
 * This script fetches contributor data from GitHub and updates the README.md file
 * with a contributors section showing avatars and usernames.
 * It also updates all localized README files in the locales directory.
 */

const https = require("https")
const fs = require("fs")
const { promisify } = require("util")
const path = require("path")

// Promisify filesystem operations
const readFileAsync = promisify(fs.readFile)
const writeFileAsync = promisify(fs.writeFile)

// GitHub API URL for fetching contributors
const GITHUB_API_URL = "https://api.github.com/repos/RooCodeInc/Roo-Code/contributors?per_page=100"
const README_PATH = path.join(__dirname, "..", "README.md")
const LOCALES_DIR = path.join(__dirname, "..", "locales")

// Sentinel markers for contributors section
const START_MARKER = "<!-- START CONTRIBUTORS SECTION - AUTO-GENERATED, DO NOT EDIT MANUALLY -->"
const END_MARKER = "<!-- END CONTRIBUTORS SECTION -->"

// HTTP options for GitHub API request
const options = {
	headers: {
		"User-Agent": "Roo-Code-Contributors-Script",
	},
}

// Add GitHub token for authentication if available
if (process.env.GITHUB_TOKEN) {
	options.headers.Authorization = `token ${process.env.GITHUB_TOKEN}`
	console.log("Using GitHub token from environment variable")
}

/**
 * Parses the GitHub API Link header to extract pagination URLs
 * Based on RFC 5988 format for the Link header
 * @param {string} header The Link header from GitHub API response
 * @returns {Object} Object containing URLs for next, prev, first, last pages (if available)
 */
function parseLinkHeader(header) {
	// Return empty object if no header is provided
	if (!header || header.trim() === "") return {}

	// Initialize links object
	const links = {}

	// Split the header into individual link entries
	// Example: <https://api.github.com/...?page=2>; rel="next", <https://api.github.com/...?page=5>; rel="last"
	const entries = header.split(/,\s*/)

	// Process each link entry
	for (const entry of entries) {
		// Extract the URL (between < and >) and the parameters (after >)
		const segments = entry.split(";")
		if (segments.length < 2) continue

		// Extract URL from the first segment, removing < and >
		const urlMatch = segments[0].match(/<(.+)>/)
		if (!urlMatch) continue
		const url = urlMatch[1]

		// Find the rel="value" parameter
		let rel = null
		for (let i = 1; i < segments.length; i++) {
			const relMatch = segments[i].match(/\s*rel\s*=\s*"?([^"]+)"?/)
			if (relMatch) {
				rel = relMatch[1]
				break
			}
		}

		// Only add to links if both URL and rel were found
		if (rel) {
			links[rel] = url
		}
	}

	return links
}

/**
 * Performs an HTTP GET request and returns the response
 * @param {string} url The URL to fetch
 * @param {Object} options Request options
 * @returns {Promise<Object>} Response object with status, headers and body
 */
function httpGet(url, options) {
	return new Promise((resolve, reject) => {
		https
			.get(url, options, (res) => {
				let data = ""
				res.on("data", (chunk) => {
					data += chunk
				})

				res.on("end", () => {
					resolve({
						statusCode: res.statusCode,
						headers: res.headers,
						body: data,
					})
				})
			})
			.on("error", (error) => {
				reject(error)
			})
	})
}

/**
 * Fetches a single page of contributors from GitHub API
 * @param {string} url The API URL to fetch
 * @returns {Promise<Object>} Object containing contributors and pagination links
 */
async function fetchContributorsPage(url) {
	try {
		// Make the HTTP request
		const response = await httpGet(url, options)

		// Check for successful response
		if (response.statusCode !== 200) {
			throw new Error(`GitHub API request failed with status code: ${response.statusCode}`)
		}

		// Parse the Link header for pagination
		const linkHeader = response.headers.link
		const links = parseLinkHeader(linkHeader)

		// Parse the JSON response
		const contributors = JSON.parse(response.body)

		return { contributors, links }
	} catch (error) {
		throw new Error(`Failed to fetch contributors page: ${error.message}`)
	}
}

/**
 * Fetches all contributors data from GitHub API (handling pagination)
 * @returns {Promise<Array>} Array of all contributor objects
 */
async function fetchContributors() {
	let allContributors = []
	let currentUrl = GITHUB_API_URL
	let pageCount = 1

	// Loop through all pages of contributors
	while (currentUrl) {
		console.log(`Fetching contributors page ${pageCount}...`)
		const { contributors, links } = await fetchContributorsPage(currentUrl)

		allContributors = allContributors.concat(contributors)

		// Move to the next page if it exists
		currentUrl = links.next
		pageCount++
	}

	console.log(`Fetched ${allContributors.length} contributors from ${pageCount - 1} pages`)
	return allContributors
}

/**
 * Reads the README.md file
 * @returns {Promise<string>} README content
 */
async function readReadme() {
	try {
		return await readFileAsync(README_PATH, "utf8")
	} catch (err) {
		throw new Error(`Failed to read README.md: ${err.message}`)
	}
}

/**
 * Creates HTML for the contributors section
 * @param {Array} contributors Array of contributor objects from GitHub API
 * @returns {string} HTML for contributors section
 */
const EXCLUDED_LOGIN_SUBSTRINGS = ['[bot]', 'R00-B0T'];
const EXCLUDED_LOGIN_EXACTS = ['cursor', 'roomote'];

function formatContributorsSection(contributors) {
	// Filter out GitHub Actions bot, cursor, and roomote
	const filteredContributors = contributors.filter((c) =>
		!EXCLUDED_LOGIN_SUBSTRINGS.some(sub => c.login.includes(sub)) &&
		!EXCLUDED_LOGIN_EXACTS.includes(c.login)
	)

	// Start building with Markdown table format
	let markdown = `${START_MARKER}
`
	// Number of columns in the table
	const COLUMNS = 6

	// Create contributor cell HTML
	const createCell = (contributor) => {
		return `<a href="${contributor.html_url}"><img src="${contributor.avatar_url}" width="100" height="100" alt="${contributor.login}"/><br /><sub><b>${contributor.login}</b></sub></a>`
	}

	if (filteredContributors.length > 0) {
		// Table header is the first row of contributors
		const headerCells = filteredContributors.slice(0, COLUMNS).map(createCell)

		// Fill any empty cells in header row
		while (headerCells.length < COLUMNS) {
			headerCells.push(" ")
		}

		// Add header row
		markdown += `|${headerCells.join("|")}|\n`

		// Add alignment row
		markdown += "|"
		for (let i = 0; i < COLUMNS; i++) {
			markdown += ":---:|"
		}
		markdown += "\n"

		// Add remaining contributor rows starting with the second batch
		for (let i = COLUMNS; i < filteredContributors.length; i += COLUMNS) {
			const rowContributors = filteredContributors.slice(i, i + COLUMNS)

			// Create cells for each contributor in this row
			const cells = rowContributors.map(createCell)

			// Fill any empty cells to maintain table structure
			while (cells.length < COLUMNS) {
				cells.push(" ")
			}

			// Add row to the table
			markdown += `|${cells.join("|")}|\n`
		}
	}

	markdown += `${END_MARKER}`
	return markdown
}

/**
 * Updates the README.md file with contributors section
 * @param {string} readmeContent Original README content
 * @param {string} contributorsSection HTML for contributors section
 * @returns {Promise<void>}
 */
async function updateReadme(readmeContent, contributorsSection) {
	// Find existing contributors section markers
	const startPos = readmeContent.indexOf(START_MARKER)
	const endPos = readmeContent.indexOf(END_MARKER)

	if (startPos === -1 || endPos === -1) {
		console.warn("Warning: Could not find contributors section markers in README.md")
		console.warn("Skipping update - please add markers to enable automatic updates.")
		return
	}

	// Replace existing section, trimming whitespace at section boundaries
	const beforeSection = readmeContent.substring(0, startPos).trimEnd()
	const afterSection = readmeContent.substring(endPos + END_MARKER.length).trimStart()
	// Ensure single newline separators between sections
	const updatedContent = beforeSection + "\n\n" + contributorsSection.trim() + "\n\n" + afterSection

	await writeReadme(updatedContent)
}

/**
 * Writes updated content to README.md
 * @param {string} content Updated README content
 * @returns {Promise<void>}
 */
async function writeReadme(content) {
	try {
		await writeFileAsync(README_PATH, content, "utf8")
	} catch (err) {
		throw new Error(`Failed to write updated README.md: ${err.message}`)
	}
}
/**
 * Finds all localized README files in the locales directory
 * @returns {Promise<string[]>} Array of README file paths
 */
async function findLocalizedReadmes() {
	const readmeFiles = []

	// Check if locales directory exists
	if (!fs.existsSync(LOCALES_DIR)) {
		// No localized READMEs found
		return readmeFiles
	}

	// Get all language subdirectories
	const languageDirs = fs
		.readdirSync(LOCALES_DIR, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name)

	// Add all localized READMEs to the list
	for (const langDir of languageDirs) {
		const readmePath = path.join(LOCALES_DIR, langDir, "README.md")
		if (fs.existsSync(readmePath)) {
			readmeFiles.push(readmePath)
		}
	}

	return readmeFiles
}

/**
 * Updates a localized README file with contributors section
 * @param {string} filePath Path to the README file
 * @param {string} contributorsSection HTML for contributors section
 * @returns {Promise<void>}
 */
async function updateLocalizedReadme(filePath, contributorsSection) {
	try {
		// Read the file content
		const readmeContent = await readFileAsync(filePath, "utf8")

		// Find existing contributors section markers
		const startPos = readmeContent.indexOf(START_MARKER)
		const endPos = readmeContent.indexOf(END_MARKER)

		if (startPos === -1 || endPos === -1) {
			console.warn(`Warning: Could not find contributors section markers in ${filePath}`)
			console.warn(`Skipping update for ${filePath}`)
			return
		}

		// Replace existing section, trimming whitespace at section boundaries
		const beforeSection = readmeContent.substring(0, startPos).trimEnd()
		const afterSection = readmeContent.substring(endPos + END_MARKER.length).trimStart()
		// Ensure single newline separators between sections
		const updatedContent = beforeSection + "\n\n" + contributorsSection.trim() + "\n\n" + afterSection

		// Write the updated content
		await writeFileAsync(filePath, updatedContent, "utf8")
		console.log(`Updated ${filePath}`)
	} catch (err) {
		console.warn(`Warning: Could not update ${filePath}: ${err.message}`)
	}
}

/**
 * Main function that orchestrates the update process
 */
async function main() {
	try {
		// Fetch contributors from GitHub (now handles pagination)
		const contributors = await fetchContributors()
		console.log(`Total contributors: ${contributors.length}`)

		// Generate contributors section
		const contributorsSection = formatContributorsSection(contributors)

		// Update main README
		const readmeContent = await readReadme()
		await updateReadme(readmeContent, contributorsSection)
		console.log(`Updated ${README_PATH}`)

		// Find and update all localized README files
		const localizedReadmes = await findLocalizedReadmes()
		console.log(`Found ${localizedReadmes.length} localized README files`)

		// Update each localized README
		for (const readmePath of localizedReadmes) {
			await updateLocalizedReadme(readmePath, contributorsSection)
		}

		console.log("Contributors section update complete")
	} catch (error) {
		console.error(`Error: ${error.message}`)
		process.exit(1)
	}
}

// Run the script
main()
