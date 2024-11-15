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
		console.log(`Added filter group: ${name} (enabled: ${enabled})`)
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
			console.log(`Filter group ${name} ${enabled ? 'enabled' : 'disabled'}`)
		}
	}

	/**
	 * Apply all enabled filters to the input text
	 * @param text Text to filter
	 * @returns Filtered text
	 */
	filterText(text: string): string {
		console.log('Starting content filtering')
		let result = removeAnsiCodes(text)
		result = removeControlCharacters(result)
		result = removeVSCodeMarkers(result)
		result = removeCommandText(result)

		for (const group of this.filterGroups.values()) {
			if (!group.enabled) {
				console.log(`Skipping disabled filter group: ${group.name}`)
				continue
			}

			console.log(`Applying filter group: ${group.name}`)
			for (const filter of group.filters) {
				const originalLength = result.length
				if (typeof filter.pattern === "string") {
					result = result.replace(new RegExp(filter.pattern, "g"), filter.replacement)
				} else {
					result = result.replace(filter.pattern, filter.replacement)
				}
				if (result.length !== originalLength) {
					console.log(`Filter matched in group ${group.name}: length changed from ${originalLength} to ${result.length}`)
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
		console.log(`Removed filter group: ${name}`)
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
				replacement: "     [==========] Downloading...",
			},
			// Clean up multiple blank lines but preserve single line breaks
			{
				pattern: /\n{3,}/g,
				replacement: "\n\n",
			},
			// Clean up any trailing whitespace
			{
				pattern: /[ \t]+$/gm,
				replacement: "",
			},
		],
	},
	npm: {
		name: "npm",
		filters: [
			// Progress and loading indicators
			{
				pattern: /^\s*[\u2500-\u259F=#\s]+.*?(\d+%|\d+\.\d+\/\d+\.\d+ (?:MB|KB)).*$/gm,
				replacement: "     [==========] Installing...",
			},
			// npm install output cleanup
			{
				pattern: /^npm.*(?:WARN|notice)\s+(?:deprecated|optional|saveError|permissions?|engine).*$/gm,
				replacement: "",
			},
			// Remove package resolution lines
			{
				pattern: /^.*?resolution:.*$/gm,
				replacement: "",
			},
			// Clean up package add/remove/update messages
			{
				pattern: /(?:added|removed|changed)\s+\d+\s+packages?,?\s*(?:and\s+\d+\s+packages?\s+(?:updated|are\s+looking\s+for\s+funding))?\s*(?:in\s+(?:\d+[ms]|(?:\d+)?\.\d+s))?/g,
				replacement: "Dependencies updated",
			},
			// Clean up audit messages
			{
				pattern: /found \d+ vulnerabilities?.*$/gm,
				replacement: "Security scan complete",
			},
			// Clean up funding messages
			{
				pattern: /^\d+\s+packages? are looking for funding.*$/gm,
				replacement: "",
			},
			// Clean up progress indicators
			{
				pattern: /^.*?⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏.*$/gm,
				replacement: "",
			},
			// Clean up npm timing messages
			{
				pattern: /^npm timing.*$/gm,
				replacement: "",
			},
			// Clean up npm http fetch messages
			{
				pattern: /^npm http fetch.*$/gm,
				replacement: "",
			},
			// Clean up package lock messages
			{
				pattern: /^.*?package-lock\.json.*$/gm,
				replacement: "",
			},
			// Clean up node_modules messages
			{
				pattern: /^.*?node_modules.*$/gm,
				replacement: "",
			},
			// Error formatting
			{
				pattern: /npm ERR!/g,
				replacement: "Error",
			},
			// Notice formatting
			{
				pattern: /npm WARN|npm notice/g,
				replacement: "Notice",
			},
			// Clean up multiple blank lines
			{
				pattern: /\n{3,}/g,
				replacement: "\n\n",
			},
			// Clean up trailing whitespace
			{
				pattern: /[ \t]+$/gm,
				replacement: "",
			},
		],
	},
	curl: {
		name: "curl",
		filters: [
			// Clean up progress meter and download stats
			{
				pattern: /^\s*\d+\s+(?:\[=*>\s*\]|\[=*\s*\])\s+(?:\d+\.\d+[KMG]?|\d+)\s+(?:\d+\.\d+[KMG]?|\d+)\s+(?:\d+\.\d+[KMG]?|\d+)\s+(?:\d+:\d+:\d+|\d+:\d+|\d+[ms])\s*$/gm,
				replacement: "     [==========] Downloading...",
			},
			// Remove transfer statistics header
			{
				pattern: /^\s*% Total\s+% Received\s+% Xferd\s+Average\s+Speed\s+Time\s+Time\s+Time\s+Current.*\n\s*Dload\s+Upload\s+Total\s+Spent\s+Left\s+Speed.*$/gm,
				replacement: "",
			},
			// Clean up TLS handshake messages
			{
				pattern: /^\* TLSv[\d.]+ \([A-Z]+\).*$/gm,
				replacement: "",
			},
			// Clean up connection information
			{
				pattern: /^\*\s+Trying \d+\.\d+\.\d+\.\d+\.\.\.\s*\n\*\s+Connected to .* \(\d+\.\d+\.\d+\.\d+\) port \d+ \(#\d+\)$/gm,
				replacement: "Connected to server",
			},
			// Clean up DNS resolution
			{
				pattern: /^\* Trying \d+\.\d+\.\d+\.\d+\.\.\.$/gm,
				replacement: "",
			},
			// Clean up certificate information
			{
				pattern: /^\* Server certificate:[\s\S]*?subject:.*$/gm,
				replacement: "",
			},
			// Clean up HTTP version information
			{
				pattern: /^\* Using HTTP.*$/gm,
				replacement: "",
			},
			// Clean up request sent message
			{
				pattern: /^\* Request written to socket.*$/gm,
				replacement: "",
			},
			// Clean up timing information
			{
				pattern: /^\* Operation timed out after \d+ milliseconds with \d+ bytes received$/gm,
				replacement: "Request timed out",
			},
			// Clean up connection reuse information
			{
				pattern: /^\* Connection #\d+ to host .* left intact$/gm,
				replacement: "",
			},
			// Clean up HTTP/2 information
			{
				pattern: /^\* Using HTTP2.*$|^\* HTTP\/2 Stream.*$|^\* Connection state changed.*$/gm,
				replacement: "",
			},
			// Clean up ALPN information
			{
				pattern: /^\* ALPN,.*$/gm,
				replacement: "",
			},
			// Clean up CAfile/CApath information
			{
				pattern: /^\*\s+CAfile:.*$|^\*\s+CApath:.*$/gm,
				replacement: "",
			},
			// Clean up all TLS handshake details
			{
				pattern: /^\* TLSv[\d.]+ \([A-Z]+\),.*$|^\* Using HTTP2.*$|^\* Connection state changed.*$|^\* Copying HTTP\/2.*$/gm,
				replacement: "",
			},
			// Format SSL connection info
			{
				pattern: /^\* SSL connection using.*$/m,
				replacement: "Secure connection established",
			},
			// Clean up certificate information but keep important details
			{
				pattern: /^\* Server certificate:[\s\S]*?SSL certificate verify ok\./gm,
				replacement: "Certificate verified",
			},
			// Format request headers
			{
				pattern: /^> ([A-Z]+.*$)/gm,
				replacement: "Request: $1",
			},
			// Format response headers
			{
				pattern: /^< ([A-Z]+.*$)/gm,
				replacement: "Response: $1",
			},
			// Clean up connection reuse information
			{
				pattern: /^\* Connection #\d+ to host .* left intact$/gm,
				replacement: "Connection maintained",
			},
			// Format error messages
			{
				pattern: /^curl: \(\d+\)/g,
				replacement: "Error",
			},
			// Clean up multiple blank lines
			{
				pattern: /\n{3,}/g,
				replacement: "\n\n",
			},
			// Clean up trailing whitespace
			{
				pattern: /[ \t]+$/gm,
				replacement: "",
			},
		],
	},
}
