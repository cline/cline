import * as vscode from 'vscode'
import * as path from 'path'

export interface PostHogUsage {
    file: string
    line: number
    column: number
    type:
        | 'import'
        | 'event tracking' // capture, identify, alias
        | 'identification' // identify, alias, register, unregister, reset
        | 'feature flags' // feature_enabled, get_feature_flag, etc.
        | 'initialization' // PostHog(), init(), api_key setting
        | 'integration' // Django, Sentry integrations
        | 'group analytics' // group_identify, group
        | 'error tracking' // capture_exception
        | 'configuration'
        | 'hook'
    context: string
    warning?: string
}

const DYNAMIC_EVENT_WARNING = 'Capturing events with dynamic names is not recommended'
const REVERSE_PROXY_WARNING =
    "You are using PostHog's host directly, which is not recommended. You should use a reverse proxy to call PostHog, see: https://posthog.com/docs/advanced/proxy"
const MAX_PROPERTIES_WARNING = 'Event is tracking too many properties, recommended max: 25'
const MAX_PROPERTIES = 25

export class CodeAnalyzer {
    private diagnosticCollection: vscode.DiagnosticCollection
    private eventTrackingMap: Map<string, { file: string; line: number; column: number }[]>
    private foundPosthogHost: boolean = false
    private foundAnyHost: boolean = false

    constructor() {
        // Create a diagnostic collection for PostHog warnings
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('posthog')
        this.eventTrackingMap = new Map()
    }

    async analyzeWorkspace(): Promise<PostHogUsage[]> {
        // Clear previous diagnostics and reset host tracking
        this.diagnosticCollection.clear()
        this.foundPosthogHost = false
        this.foundAnyHost = false

        const workspaceFolders = vscode.workspace.workspaceFolders
        if (!workspaceFolders) {
            return []
        }

        const usages: PostHogUsage[] = []

        // First pass: scan for host settings
        for (const folder of workspaceFolders) {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/*.{py,ts,tsx}'),
                '**/node_modules/**'
            )

            for (const file of files) {
                const content = await vscode.workspace.fs.readFile(file)
                const text = new TextDecoder().decode(content)

                this.checkHostSettings(text)

                // If we found a posthog.com host, we can stop searching as we'll need to show warnings
                if (this.foundPosthogHost) {
                    break
                }
            }

            if (this.foundPosthogHost) {
                break
            }
        }

        // Second pass: normal analysis
        for (const folder of workspaceFolders) {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/*.{py,ts,tsx}'),
                '**/node_modules/**'
            )

            for (const file of files) {
                const fileUsages = await this.analyzeFile(file)
                usages.push(...fileUsages)
            }
        }

        // Deduplicate before showing warnings
        const dedupedUsages = this.deduplicateUsages(usages)

        // After analyzing, show warnings
        this.showWarnings(dedupedUsages)

        // Return the deduped usages directly - no need to split warnings
        return dedupedUsages
    }

    private deduplicateUsages(usages: PostHogUsage[]): PostHogUsage[] {
        const mergedUsages = new Map<string, PostHogUsage>()

        for (const usage of usages) {
            const key = `${usage.file}:${usage.line}`
            const existingUsage = mergedUsages.get(key)

            if (existingUsage) {
                // Keep the first type encountered
                // Merge warnings if they're different
                if (usage.warning && (!existingUsage.warning || !existingUsage.warning.includes(usage.warning))) {
                    existingUsage.warning = existingUsage.warning
                        ? `${existingUsage.warning}; ${usage.warning}`
                        : usage.warning
                }

                // Keep the earliest column position
                existingUsage.column = Math.min(existingUsage.column, usage.column)
            } else {
                mergedUsages.set(key, { ...usage })
            }
        }

        return Array.from(mergedUsages.values())
    }

    private async analyzeFile(file: vscode.Uri): Promise<PostHogUsage[]> {
        const content = await vscode.workspace.fs.readFile(file)
        const text = new TextDecoder().decode(content)
        const ext = path.extname(file.fsPath).toLowerCase()
        const usages: PostHogUsage[] = []

        if (ext === '.py') {
            this.analyzePythonFile(text, file.fsPath, usages)
        } else if (ext === '.ts' || ext === '.tsx') {
            this.analyzeTypeScriptFile(text, file.fsPath, usages)
        }

        return this.deduplicateUsages(usages)
    }

    private analyzePythonFile(text: string, filePath: string, usages: PostHogUsage[]) {
        const lines = text.split('\n')

        // Import patterns
        const importPatterns = [/^import\s+posthog/i, /^from\s+posthog\s+import/i, /^import\s+posthog-analytics/i]

        // Add initialization patterns back
        const initializationPatterns = [
            {
                pattern: /\w+\s*=\s*PostHog\((.*?)(?:\)|$)/i,
                checkHost: () => {
                    return this.foundPosthogHost || !this.foundAnyHost
                },
            },
            {
                pattern: /\w+\s*=\s*posthog\.PostHog\((.*?)(?:\)|$)/i,
                checkHost: () => {
                    return this.foundPosthogHost || !this.foundAnyHost
                },
            },
        ]

        // Configuration patterns (any attribute setting)
        const configurationPatterns = [/posthog\.\w+\s*=/i]

        // Event tracking patterns with dynamic name and property detection
        const eventTrackingPatterns = [
            {
                pattern: /posthog\.capture\((.*?)(?:\)|$)/i,
                isDynamic: (match: string) => {
                    // Check for f-strings, .format(), % formatting, string concatenation
                    return (
                        /f['"].*?[{}].*?['"]/.test(match) || // f-strings
                        /\.format\(/.test(match) || // .format()
                        /%[sd]/.test(match) || // % formatting
                        /\s*\+\s*/.test(match) || // string concatenation
                        /\$\{.*?\}/.test(match)
                    ) // template literals
                },
                checkProperties: (match: string) => {
                    // Check for properties in Python dict format
                    const propertiesMatch = match.match(/properties\s*=\s*{([^}]*)}/)
                    if (propertiesMatch) {
                        const properties = propertiesMatch[1].split(',').filter((p) => p.trim())
                        if (properties.length > MAX_PROPERTIES) {
                            return MAX_PROPERTIES_WARNING
                        }
                    }
                    // Check for direct dict as third argument
                    const directPropsMatch = match.match(/,\s*{([^}]*)}/)
                    if (directPropsMatch) {
                        const properties = directPropsMatch[1].split(',').filter((p) => p.trim())
                        if (properties.length > MAX_PROPERTIES) {
                            return MAX_PROPERTIES_WARNING
                        }
                    }
                    return undefined
                },
            },
        ]

        // Feature flag patterns
        const featureFlagPatterns = [
            /posthog\.feature_enabled\(/i,
            /posthog\.get_feature_flag\(/i,
            /posthog\.get_all_flags\(/i,
            /posthog\.get_all_flags_and_payloads\(/i,
        ]

        // Group analytics patterns
        const groupPatterns = [/posthog\.group_identify\(/i]

        // Error tracking patterns
        const errorTrackingPatterns = [/posthog\.capture_exception\(/i]

        // Updated host setting pattern to include all variants
        const hostSettingPattern = {
            pattern: /(?:posthog|client)\.\w*host\w*\s*=\s*['"].*?(?:posthog\.com|i\.posthog\.com)/i,
            type: 'initialization' as const,
        }

        // Helper function to get the full context including multiline implementations
        const getFullContext = (line: string, lineIndex: number): string => {
            let context = line
            let currentIndex = lineIndex + 1
            let bracketCount = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length

            // Keep adding lines until we find the matching closing bracket
            while (bracketCount > 0 && currentIndex < lines.length) {
                const nextLine = lines[currentIndex]
                context += '\n' + nextLine
                bracketCount += (nextLine.match(/\(/g) || []).length
                bracketCount -= (nextLine.match(/\)/g) || []).length
                currentIndex++
            }

            return context
        }

        lines.forEach((line, index) => {
            const lineNumber = index + 1

            // Helper function to add usage
            const addUsage = (pattern: RegExp, type: PostHogUsage['type']) => {
                const match = line.match(pattern)
                if (match) {
                    const fullContext = getFullContext(line, index)
                    usages.push({
                        file: filePath,
                        line: lineNumber,
                        column: line.indexOf(match[0]),
                        type,
                        context: fullContext,
                    })
                }
            }

            // Check each pattern type
            importPatterns.forEach((pattern) => addUsage(pattern, 'import'))

            // Add initialization pattern checks back
            initializationPatterns.forEach(({ pattern, checkHost }) => {
                const match = line.match(pattern)
                if (match) {
                    const fullContext = getFullContext(line, index)
                    const usage: PostHogUsage = {
                        file: filePath,
                        line: lineNumber,
                        column: line.indexOf(match[0]),
                        type: 'initialization',
                        context: fullContext,
                    }

                    if (checkHost()) {
                        usage.warning = REVERSE_PROXY_WARNING
                    }

                    usages.push(usage)
                }
            })
            configurationPatterns.forEach((pattern) => addUsage(pattern, 'configuration'))
            eventTrackingPatterns.forEach(({ pattern, isDynamic, checkProperties }) => {
                const match = line.match(pattern)
                if (match) {
                    const fullContext = getFullContext(line, index)
                    const usage: PostHogUsage = {
                        file: filePath,
                        line: lineNumber,
                        column: line.indexOf(match[0]),
                        type: 'event tracking',
                        context: fullContext,
                    }

                    if (isDynamic(fullContext)) {
                        usage.warning = DYNAMIC_EVENT_WARNING
                    }

                    const propertyWarning = checkProperties?.(fullContext)
                    if (propertyWarning) {
                        usage.warning = usage.warning ? `${usage.warning}; ${propertyWarning}` : propertyWarning
                    }

                    usages.push(usage)
                }
            })
            featureFlagPatterns.forEach((pattern) => addUsage(pattern, 'feature flags'))
            groupPatterns.forEach((pattern) => addUsage(pattern, 'group analytics'))

            // Check direct host setting
            const hostMatch = line.match(hostSettingPattern.pattern)
            if (hostMatch) {
                const fullContext = getFullContext(line, index)
                usages.push({
                    file: filePath,
                    line: lineNumber,
                    column: line.indexOf(hostMatch[0]),
                    type: hostSettingPattern.type,
                    context: fullContext,
                    warning: REVERSE_PROXY_WARNING,
                })
            }
        })
    }

    private analyzeTypeScriptFile(text: string, filePath: string, usages: PostHogUsage[]) {
        const lines = text.split('\n')

        // Import patterns
        const importPatterns = [
            /^import\s+.*from\s+['"]posthog-js['"]/i,
            /^import\s+.*from\s+['"]posthog['"]/i,
            /^import\s+.*from\s+['"]@posthog\/react-native['"]/i,
        ]

        // Remove usePostHog from initialization patterns and create new hook patterns
        const hookPatterns = [
            {
                pattern: /usePostHog\((.*?)(?:\)|$)/i,
                type: 'hook' as const,
            },
        ]

        const initializationPatterns = [
            {
                pattern: /<PostHogProvider[^>]*>/i,
                checkHost: () => {
                    return this.foundPosthogHost || !this.foundAnyHost
                },
            },
            {
                pattern: /new\s+PostHog\((.*?)(?:\)|$)/i,
                checkHost: () => {
                    return this.foundPosthogHost || !this.foundAnyHost
                },
            },
            {
                pattern: /posthog(?:\?)?\.init\((.*?)(?:\)|$)/i,
                checkHost: () => {
                    return this.foundPosthogHost || !this.foundAnyHost
                },
            },
        ]

        // Updated event tracking patterns with dynamic name detection
        const eventTrackingPatterns = [
            {
                pattern: /posthog(?:\?)?\.capture\(\s*(?:['"`].*?['"`])/i,
                isDynamic: (match: string) => {
                    return (
                        /`.*?\${.*?}.*?`/.test(match) || // template literals
                        /\s*\+\s*/.test(match) || // string concatenation
                        /\(\s*[^"'`]\w+\s*\)/.test(match) // variable as event name
                    )
                },
                getEventName: (match: string) => {
                    // Handle both regular strings and template literals
                    const eventNameMatch = match.match(/posthog(?:\?)?\.capture\(\s*([`'"'])(.*?)\1/i)
                    if (eventNameMatch) {
                        const [_, quoteType, eventName] = eventNameMatch
                        // If it's a template literal, mark it as dynamic
                        return quoteType === '`' ? null : eventName
                    }
                    return null
                },
                checkProperties: (match: string, line: string, lineIndex: number) => {
                    // Look for properties in current and next few lines
                    let fullCall = line
                    let curIndex = lineIndex
                    let bracketCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length

                    // Keep adding lines until we find the matching closing bracket
                    while (bracketCount > 0 && curIndex + 1 < lines.length) {
                        curIndex++
                        const nextLine = lines[curIndex]
                        fullCall += '\n' + nextLine
                        bracketCount += (nextLine.match(/{/g) || []).length
                        bracketCount -= (nextLine.match(/}/g) || []).length
                    }

                    // Now look for the properties object in the full call
                    const propertiesMatch = fullCall.match(/,\s*({[\s\S]*?})/)
                    if (propertiesMatch) {
                        const propertiesObj = propertiesMatch[1]
                        // Count properties by looking for property names followed by colons, handling multi-line
                        const properties = propertiesObj.match(/\w+\s*:/g) || []
                        if (properties.length > MAX_PROPERTIES) {
                            return MAX_PROPERTIES_WARNING
                        }
                    }
                    return undefined
                },
            },
        ]

        // Updated user identification patterns
        const userIdentificationPatterns = [
            /posthog(?:\?)?\.identify\(/i,
            /posthog(?:\?)?\.alias\(/i,
            /posthog(?:\?)?\.register\(/i,
            /posthog(?:\?)?\.unregister\(/i,
            /posthog(?:\?)?\.reset\(/i,
        ]

        // Updated opt-in/out patterns
        const optInOutPatterns = [
            /posthog(?:\?)?\.opt_out_capturing\(/i,
            /posthog(?:\?)?\.opt_in_capturing\(/i,
            /posthog(?:\?)?\.has_opted_out_capturing\(/i,
            /posthog(?:\?)?\.optedOut\b/i,
            /posthog(?:\?)?\.optIn\(/i,
            /posthog(?:\?)?\.optOut\(/i,
        ]

        // Updated queue management patterns
        const queueManagementPatterns = [/posthog(?:\?)?\.flush\(/i]

        // Updated feature flag patterns
        const featureFlagPatterns = [
            /useFeatureFlag\(/i,
            /posthog(?:\?)?\.isFeatureEnabled\(/i,
            /posthog(?:\?)?\.getFeatureFlag\(/i,
            /posthog(?:\?)?\.getFeatureFlagPayload\(/i,
            /posthog(?:\?)?\.reloadFeatureFlagsAsync\(/i,
            /posthog(?:\?)?\.reloadFeatureFlags\(/i,
        ]

        // Updated flag property patterns
        const flagPropertyPatterns = [
            /posthog(?:\?)?\.setPersonPropertiesForFlags\(/i,
            /posthog(?:\?)?\.resetPersonPropertiesForFlags\(/i,
            /posthog(?:\?)?\.setGroupPropertiesForFlags\(/i,
            /posthog(?:\?)?\.resetGroupPropertiesForFlags\(/i,
        ]

        // Updated group patterns
        const groupPatterns = [/posthog(?:\?)?\.group\(/i]

        // Updated host setting pattern to include all variants
        const hostSettingPattern = {
            pattern: /(?:posthog|client)\.\w*host\w*\s*=\s*['"].*?(?:posthog\.com|i\.posthog\.com)/i,
            type: 'initialization' as const,
        }

        // Helper function to get the full context including multiline implementations
        const getFullContext = (line: string, lineIndex: number): string => {
            let context = line
            let currentIndex = lineIndex + 1
            let bracketCount = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length

            // Keep adding lines until we find the matching closing bracket
            while (bracketCount > 0 && currentIndex < lines.length) {
                const nextLine = lines[currentIndex]
                context += '\n' + nextLine
                bracketCount += (nextLine.match(/\(/g) || []).length
                bracketCount -= (nextLine.match(/\)/g) || []).length
                currentIndex++
            }

            return context
        }

        lines.forEach((line, index) => {
            const lineNumber = index + 1

            const addUsage = (pattern: RegExp, type: PostHogUsage['type']) => {
                const match = line.match(pattern)
                if (match) {
                    const fullContext = getFullContext(line, index)
                    usages.push({
                        file: filePath,
                        line: lineNumber,
                        column: line.indexOf(match[0]),
                        type,
                        context: fullContext,
                    })
                }
            }

            // Check each pattern type
            importPatterns.forEach((pattern) => addUsage(pattern, 'import'))
            initializationPatterns.forEach(({ pattern, checkHost }) => {
                const match = line.match(pattern)
                if (match) {
                    const fullContext = getFullContext(line, index)
                    const usage: PostHogUsage = {
                        file: filePath,
                        line: lineNumber,
                        column: line.indexOf(match[0]),
                        type: 'initialization',
                        context: fullContext,
                    }

                    if (checkHost()) {
                        usage.warning = REVERSE_PROXY_WARNING
                    }

                    usages.push(usage)
                }
            })
            eventTrackingPatterns.forEach(({ pattern, isDynamic, getEventName, checkProperties }) => {
                const match = line.match(pattern)
                if (match) {
                    const fullContext = getFullContext(line, index)
                    const eventName = getEventName?.(fullContext)
                    const usage: PostHogUsage = {
                        file: filePath,
                        line: lineNumber,
                        column: line.indexOf(match[0]),
                        type: 'event tracking',
                        context: fullContext,
                    }

                    if (isDynamic(fullContext)) {
                        usage.warning = DYNAMIC_EVENT_WARNING
                    }

                    const propertyWarning = checkProperties?.(fullContext, line, index)
                    if (propertyWarning) {
                        usage.warning = usage.warning ? `${usage.warning}; ${propertyWarning}` : propertyWarning
                    }

                    // Track event name and location
                    if (eventName) {
                        const locations = this.eventTrackingMap.get(eventName) || []
                        locations.push({
                            file: filePath,
                            line: lineNumber,
                            column: line.indexOf(match[0]),
                        })
                        this.eventTrackingMap.set(eventName, locations)
                    }

                    usages.push(usage)
                }
            })
            userIdentificationPatterns.forEach((pattern) => addUsage(pattern, 'identification'))
            optInOutPatterns.forEach((pattern) => addUsage(pattern, 'configuration'))
            queueManagementPatterns.forEach((pattern) => addUsage(pattern, 'configuration'))
            featureFlagPatterns.forEach((pattern) => addUsage(pattern, 'feature flags'))
            flagPropertyPatterns.forEach((pattern) => addUsage(pattern, 'feature flags'))
            groupPatterns.forEach((pattern) => addUsage(pattern, 'group analytics'))

            // Check direct host setting
            const hostMatch = line.match(hostSettingPattern.pattern)
            if (hostMatch) {
                const fullContext = getFullContext(line, index)
                usages.push({
                    file: filePath,
                    line: lineNumber,
                    column: line.indexOf(hostMatch[0]),
                    type: hostSettingPattern.type,
                    context: fullContext,
                    warning: REVERSE_PROXY_WARNING,
                })
            }

            // Add hook pattern check
            hookPatterns.forEach(({ pattern, type }) => addUsage(pattern, type))
        })
    }

    private calculateStringSimilarity(str1: string, str2: string): number {
        // Levenshtein distance implementation
        const matrix: number[][] = []

        for (let i = 0; i <= str1.length; i++) {
            matrix[i] = [i]
        }

        for (let j = 0; j <= str2.length; j++) {
            matrix[0][j] = j
        }

        for (let i = 1; i <= str1.length; i++) {
            for (let j = 1; j <= str2.length; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1]
                } else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                }
            }
        }

        const distance = matrix[str1.length][str2.length]
        const maxLength = Math.max(str1.length, str2.length)
        return 1 - distance / maxLength
    }

    private showWarnings(usages: PostHogUsage[]) {
        const diagnosticMap = new Map<string, vscode.Diagnostic[]>()
        const SIMILARITY_THRESHOLD = 0.7

        // First pass: Check for similar events and update usage objects
        for (const usage of usages) {
            if (usage.type === 'event tracking') {
                const eventName = usage.context.match(/posthog(?:\?)?\.capture\(\s*['"](.+?)['"]/i)?.[1]

                if (eventName) {
                    // Check all other event tracking usages for similar names
                    const similarEvents = usages
                        .filter(
                            (otherUsage) =>
                                otherUsage.type === 'event tracking' &&
                                otherUsage.file !== usage.file &&
                                otherUsage !== usage
                        )
                        .map((otherUsage) => {
                            const otherEventName = otherUsage.context.match(
                                /posthog(?:\?)?\.capture\(\s*['"](.+?)['"]/i
                            )?.[1]
                            return otherEventName
                                ? {
                                      similarity: this.calculateStringSimilarity(eventName, otherEventName),
                                      usage: otherUsage,
                                      eventName: otherEventName,
                                  }
                                : null
                        })
                        .filter(
                            (result): result is NonNullable<typeof result> =>
                                result !== null && result.similarity >= SIMILARITY_THRESHOLD
                        )

                    if (similarEvents.length > 0) {
                        // Sort by similarity descending
                        similarEvents.sort((a, b) => b.similarity - a.similarity)
                        const mostSimilar = similarEvents[0]
                        const similarFile = path.basename(mostSimilar.usage.file)
                        const similarWarning = `Similar event "${mostSimilar.eventName}" (${(
                            mostSimilar.similarity * 100
                        ).toFixed(1)}% similar) is tracked in ${similarFile}`
                        usage.warning = usage.warning ? `${usage.warning}; ${similarWarning}` : similarWarning
                    }
                }
            }
        }

        // Second pass: Create diagnostics for all warnings
        for (const usage of usages) {
            if (usage.warning) {
                // Split multiple warnings and create a diagnostic for each
                const warnings = usage.warning.split(';').map((w) => w.trim())
                const diagnostics = diagnosticMap.get(usage.file) || []

                for (const warning of warnings) {
                    if (!warning) {
                        continue
                    } // Skip empty warnings

                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(
                            usage.line - 1,
                            usage.column,
                            usage.line - 1,
                            usage.column + usage.context.length
                        ),
                        `PostHog: ${warning}`,
                        vscode.DiagnosticSeverity.Warning
                    )

                    // Add related information only for similar event warnings
                    if (warning.includes('Similar event')) {
                        const similarLocation = this.eventTrackingMap
                            .get(usage.context.match(/posthog(?:\?)?\.capture\(\s*['"](.+?)['"]/i)?.[1] || '')
                            ?.find((loc) => loc.file !== usage.file)

                        if (similarLocation) {
                            diagnostic.relatedInformation = [
                                new vscode.DiagnosticRelatedInformation(
                                    new vscode.Location(
                                        vscode.Uri.file(similarLocation.file),
                                        new vscode.Position(similarLocation.line - 1, similarLocation.column)
                                    ),
                                    `Similar event tracked here`
                                ),
                            ]
                        }
                    }

                    diagnostics.push(diagnostic)
                }

                diagnosticMap.set(usage.file, diagnostics)
            }
        }

        // Set diagnostics for each file
        for (const [file, diagnostics] of diagnosticMap.entries()) {
            this.diagnosticCollection.set(vscode.Uri.file(file), diagnostics)
        }
    }

    private checkHostSettings(text: string): void {
        // Combined pattern for both Python and TypeScript syntax, including variable assignments
        const hostPatterns = [
            // String literal assignments
            /(?:host|api_host|ui_host)\s*[=:]\s*['"]([^'"]*)['"]/i,
            // Variable/constant assignments
            /(?:host|api_host|ui_host)\s*[=:]\s*([A-Z_][A-Z0-9_]*|\w+(?:\.\w+)*)\b/i,
        ]

        for (const pattern of hostPatterns) {
            const matches = text.matchAll(new RegExp(pattern, 'g'))
            for (const match of matches) {
                this.foundAnyHost = true
                // If it's a string literal and contains posthog.com
                if (match[1] && typeof match[1] === 'string' && match[1].includes('posthog.com')) {
                    this.foundPosthogHost = true
                    return
                }
                // If it's a variable assignment, we consider it a custom host
                if (match[1] && !match[1].match(/['"`]/)) {
                    return // Found a variable assignment, treat it as a custom host
                }
            }
        }
    }
}
