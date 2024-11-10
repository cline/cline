interface ContentFilter {
	pattern: RegExp | string
	replacement: string
}

interface FilterGroup {
	name: string
	filters: ContentFilter[]
	enabled: boolean
}

/**
 * Manages content filtering for terminal output
 */
export class ContentFilterManager {
	private filterGroups: Map<string, FilterGroup> = new Map()

	/**
	 * Add a new filter group
	 * @param name Unique identifier for the filter group
	 * @param filters Array of filters to apply
	 * @param enabled Whether the filter group should be active
	 */
	addFilterGroup(name: string, filters: ContentFilter[], enabled: boolean = true): void {
		this.filterGroups.set(name, { name, filters, enabled })
	}

	/**
	 * Enable or disable a filter group
	 * @param name Name of the filter group
	 * @param enabled Whether to enable or disable
	 */
	setGroupEnabled(name: string, enabled: boolean): void {
		const group = this.filterGroups.get(name)
		if (group) {
			group.enabled = enabled
		}
	}

	/**
	 * Apply all enabled filters to the input text
	 * @param text Text to filter
	 * @returns Filtered text
	 */
	filterText(text: string): string {
		let result = removeAnsiCodes(text)
		result = removeControlCharacters(result)
		result = removeVSCodeMarkers(result) // added in attempt to format better
		result = removeCommandText(result) // interesting add but we might want to remove it.

		for (const group of this.filterGroups.values()) {
			if (!group.enabled) {
				continue
			}

			for (const filter of group.filters) {
				if (typeof filter.pattern === "string") {
					result = result.replace(new RegExp(filter.pattern, "g"), filter.replacement)
				} else {
					result = result.replace(filter.pattern, filter.replacement)
				}
			}
		}

		result = ensureProperLineEndings(result)
		return result
	}

	/**
	 * Remove a filter group
	 * @param name Name of the filter group to remove
	 */
	removeFilterGroup(name: string): void {
		this.filterGroups.delete(name)
	}

	/**
	 * Get all filter groups
	 * @returns Array of filter groups
	 */
	getFilterGroups(): FilterGroup[] {
		return Array.from(this.filterGroups.values())
	}
}

// o1 added - Cleaning functions
function removeAnsiCodes(str: string): string {
    // Regex to match ANSI escape sequences
    return str.replace(
        // eslint-disable-next-line no-control-regex
        /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
        ''
    )
}

function removeControlCharacters(str: string): string {
    return str.replace(/[\x00-\x1F\x7F]/g, '') // Removes ASCII control characters
}
// o1 added - Cleaning functions
 
// added in attempt to format better
function removeVSCodeMarkers(str: string): string {
    // Remove VSCode terminal integration markers and their content
    return str.replace(/(?:;cd\s+[^;]+|;\w{8}-\w{4}-\w{4}-\w{4}-\w{12}|\d{3};[A-Z]|;C(?!\w))/g, '')
}

//this is interesting but we might want it in here.
function removeCommandText(str: string): string {
    // Remove the command and any path before it
    return str.replace(/^.*?(?:venv\/bin\/activate && pip install.*?\s+)?/g, '')
}

function ensureProperLineEndings(str: string): string {
    // Normalize line endings and ensure proper spacing
    return str
        .replace(/\r\n/g, '\n')  // Convert Windows line endings
        .replace(/\r/g, '\n')    // Convert old Mac line endings
        // Format installation messages
        .replace(/(Installing collected packages:)/, '\n$1\n')
        .replace(/([a-zA-Z0-9-]+)(Successfully installed)/, '$1\n\n$2')  // Add double newline before Successfully
		//does not work
		// .replace(/([a-zA-Z0-9-]+)(Successfully installed)/, '$1\n\n$2')  // Add double newline before Successfully
		// .split(/(Successfully installed)/)  // Split at Successfully installed
        // .map(part => part.trim())  // Trim each part
        // .join('\n')  // Join with newlines
		//does not work
        // Clean up
        .replace(/\n{3,}/g, '\n\n')  // Remove excessive blank lines
        .trim()  // Final trim
}
// added in attempt to format better

// Pre-defined filter groups
export const defaultFilters = {
	pip: {
		name: "pip",
		filters: [
			// Remove any line starting with "Collecting" (including indented and with requirements)
			{
				pattern: /^.*Collecting.*(?:\r?\n|\r)?/gm,
				replacement: "",
			},
			// Remove any line starting with "Downloading" (including indented)
			{
				pattern: /^\s*Downloading\s+.*$(\r?\n)?/gm,
				replacement: "",
			},
			// Progress bar line - replace with simplified version
			{
				pattern: /^\s*[\u2500-\u259F=#\s]+.*?(\d+%|\d+\.\d+\/\d+\.\d+ (?:MB|KB)).*$/gm,
				// pattern: /^\s*[━]+[\s\S]*?(\d+\.\d+\/\d+\.\d+ (?:MB|KB))(?: \d+\.\d+ (?:MB|KB)\/s)?(?: eta [0-9:-]+)?$/gm,
				// pattern: /^\s*[━─╸╺╾╼]+.*\r?$/gm,
				// pattern: /^\s*[━─╸╺╾╼]+.*$/gm,
				replacement: "     [==========] Downloading...",
			},
			// Clean up multiple blank lines but preserve single line breaks
			{
				pattern: /\n{3,}/g,
				// Remove empty lines after our replacements
				//pattern: /\n\s*\n\s*\n/g,
				replacement: "\n\n",
			},
			// Clean up any trailing whitespace
			{
				pattern: /[ \t]+$/gm,
				replacement: "",
			},
			// Installation summary cleanup
			// {
			// 	pattern: /Installing collected packages:.*$/gm,
			// 	replacement: "Installing packages...",
			// },
			// Successfully installed cleanup
			// {
			// 	pattern: /Successfully installed.*$/gm,
			// 	replacement: "Installation complete.",
			// },
		],
	},
	npm: {
		name: "npm",
		filters: [
			{
				pattern: /(added|removed|changed)\s+\d+\s+packages?/g,
				replacement: "Dependencies updated",
			},
			{
				pattern: /found \d+ vulnerabilities/g,
				replacement: "Security scan complete",
			},
			{
				pattern: /npm WARN/g,
				replacement: "Notice",
			},
			{
				pattern: /npm ERR!/g,
				replacement: "Error",
			},
		],
	},
	// Add more filter groups as needed
}

// Example usage:
/*
const filterManager = new ContentFilterManager()

// Add pip-specific filters
filterManager.addFilterGroup(defaultFilters.pip.name, defaultFilters.pip.filters)

// Use in TerminalProcess.ts:
for await (let data of stream) {
    data = filterManager.filterText(data)
    // ... rest of the processing
}
*/
