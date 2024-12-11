import { Anthropic } from "@anthropic-ai/sdk";
import { ApiHandler } from "../../api";
import { ApiStream } from "../../api/transform/stream";
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
 * Helper function to convert API stream to string
 * @param stream API response stream
 * @returns Concatenated string response
 */
export async function streamToString(stream: ApiStream): Promise<string> {
    let result = '';
    for await (const chunk of stream) {
        if (typeof chunk === 'string') {
            result += chunk;
        } else if (chunk.type === 'text') {
            result += chunk.text;
        }
    }
    return result;
}

/**
 * Uses the AI agent to generate a structured context summary
 * @param messages Conversation history to analyze
 * @param api API handler instance
 * @returns Agent-generated context summary
 */
export async function generateAgentContext(messages: MessageParam[], api: ApiHandler): Promise<ContextSummary> {
    const systemPrompt = `Analyze the following conversation and generate a structured summary.
Focus on:
1. Key points and insights
2. Important file references
3. Critical decisions made
Keep each category limited to essential information.
Format the output as JSON matching the following interface:
{
    "key_points": string[],
    "important_files": string[],
    "critical_decisions": string[]
}`;

    try {
        const stream = await api.createMessage(systemPrompt, messages);
        const response = await streamToString(stream);

        const summary: ContextSummary = JSON.parse(response);
        return {
            key_points: summary.key_points?.slice(0, 10) ?? [],
            important_files: summary.important_files?.slice(0, 10) ?? [],
            critical_decisions: summary.critical_decisions?.slice(0, 5) ?? [],
            timestamp: Date.now()
        };
    } catch (error) {
        console.error('Failed to parse agent-generated context:', error);
        // Fallback to existing mechanism if parsing fails
        return preserveContext(messages, api);
    }
}

/**
 * Extracts key information from conversation history before truncation
 * @param messages Conversation history to analyze
 * @param api API handler instance to use for agent-based generation
 * @returns Structured summary of important context
 */
export async function preserveContext(messages: MessageParam[], api: ApiHandler): Promise<ContextSummary> {
    try {
        // Attempt agent-based context generation first
        return await generateAgentContext(messages, api);
    } catch (error) {
        console.error('Agent context generation failed, falling back to automatic extraction:', error);

        // Fallback to existing regex-based extraction
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
