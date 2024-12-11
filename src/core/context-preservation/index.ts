import { Anthropic } from "@anthropic-ai/sdk";
type MessageParam = Anthropic.Messages.MessageParam;

/**
 * Structure for storing preserved context before truncation
 */
export interface ContextSummary {
    key_points: string[];
    important_files: string[];
    critical_decisions: string[];
    timestamp: number;
}

/**
 * Extracts key information from conversation history before truncation
 * @param messages Conversation history to analyze
 * @returns Structured summary of important context
 */
export async function preserveContext(messages: MessageParam[]): Promise<ContextSummary> {
    const key_points: string[] = [];
    const important_files: string[] = [];
    const critical_decisions: string[] = [];

    // Process messages in reverse order (most recent first)
    for (const message of messages.reverse()) {
        if (!message.content || typeof message.content !== 'string') {
            continue;
        }

        const content = message.content;

        // Extract file references
        const fileMatches = content.match(/(?:\/[^\s/]+)+\.[a-zA-Z0-9]+/g);
        if (fileMatches) {
            important_files.push(...fileMatches.filter((file: string) => !important_files.includes(file)));
        }

        // Extract critical decisions (look for decision indicators)
        if (content.toLowerCase().includes('decided to') ||
            content.toLowerCase().includes('choosing to') ||
            content.toLowerCase().includes('will implement')) {
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.toLowerCase().includes('decided to') ||
                    line.toLowerCase().includes('choosing to') ||
                    line.toLowerCase().includes('will implement')) {
                    critical_decisions.push(line.trim());
                }
            }
        }

        // Extract key points (look for important statements)
        if (content.includes('- [') || content.includes('* [') ||
            content.includes('NOTE:') || content.includes('IMPORTANT:')) {
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.includes('- [') || line.includes('* [') ||
                    line.includes('NOTE:') || line.includes('IMPORTANT:')) {
                    key_points.push(line.trim());
                }
            }
        }

        // Limit the size of arrays to prevent excessive token usage
        if (key_points.length > 10) {
            break;
        }
    }

    return {
        key_points: key_points.slice(0, 10),
        important_files: important_files.slice(0, 10),
        critical_decisions: critical_decisions.slice(0, 5),
        timestamp: Date.now()
    };
}

/**
 * Injects preserved context back into the conversation when needed
 * @param systemPrompt The system prompt to inject context into
 * @param summary Previously preserved context summary
 * @returns Updated system prompt with preserved context
 */
export function injectPreservedContext(systemPrompt: string, summary: ContextSummary): string {
    // Create a context summary string
    const contextSummary =
        `Previous Context Summary (${new Date(summary.timestamp).toISOString()}):\n\n` +
        (summary.key_points.length > 0 ?
            `Key Points:\n${summary.key_points.map(p => `- ${p}`).join('\n')}\n\n` : '') +
        (summary.important_files.length > 0 ?
            `Important Files:\n${summary.important_files.map(f => `- ${f}`).join('\n')}\n\n` : '') +
        (summary.critical_decisions.length > 0 ?
            `Critical Decisions:\n${summary.critical_decisions.map(d => `- ${d}`).join('\n')}` : '');

    // Inject the context summary after the first paragraph of the system prompt
    const firstParaEnd = systemPrompt.indexOf('\n\n');
    if (firstParaEnd === -1) {
        return `${systemPrompt}\n\n${contextSummary}`;
    }
    return `${systemPrompt.slice(0, firstParaEnd)}\n\n${contextSummary}${systemPrompt.slice(firstParaEnd)}`;
}
