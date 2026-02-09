# Cline+ DAG-Aware Agent — LLM Integration Specification

## Overview

This document specifies how the Cline+ extension integrates with LLM providers to execute beads. It covers prompt construction, context injection from the DAG, token management, and response parsing. This fills the placeholder `executeBead()` implementation in the agent-build specification.

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

- [x] Multi-provider LLM support exists in Beadsmith (Anthropic/OpenAI/local/others)
- [~] DAG-aware context injection exists as a prompt component, but dagImpact selection/injection is not wired
- [~] Token management + retry/error handling exist, but this spec's bead-executor flow is only partially reflected

## Supported Providers

| Provider | API | Models | Token Counting |
|----------|-----|--------|----------------|
| Anthropic | Messages API | claude-sonnet-4-20250514, claude-opus-4-20250514 | Native via API |
| OpenAI | Chat Completions | gpt-4o, gpt-4-turbo | tiktoken library |
| Ollama | Local REST API | llama3, codellama, mistral | Approximate |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Bead Executor                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │ Context Builder │    │ Response Parser             │    │
│  │                 │    │                             │    │
│  │ • DAG context   │    │ • Extract file changes      │    │
│  │ • Task context  │    │ • Parse tool calls          │    │
│  │ • Error context │    │ • Detect completion         │    │
│  └────────┬────────┘    └──────────────┬──────────────┘    │
│           │                            │                    │
│           ▼                            ▼                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Provider Adapter Interface              │   │
│  └─────────────────────────────────────────────────────┘   │
│           │                            │                    │
│     ┌─────┴─────┐              ┌──────┴──────┐             │
│     ▼           ▼              ▼              ▼             │
│ ┌────────┐ ┌────────┐    ┌────────┐    ┌──────────┐        │
│ │Anthropic│ │ OpenAI │    │ Ollama │    │ Custom   │        │
│ │ Adapter │ │ Adapter│    │ Adapter│    │ Adapter  │        │
│ └────────┘ └────────┘    └────────┘    └──────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

### Provider Interface

Create `src/extension/llm/provider.ts`:

```typescript
import type { ProjectGraph, ImpactReport } from '../dag/types';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface LLMProviderConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  /**
   * Send a message to the LLM and get a response.
   */
  complete(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse>;

  /**
   * Count tokens in a string without making an API call.
   */
  countTokens(text: string): number;

  /**
   * Get the maximum context window size for the current model.
   */
  getMaxContextTokens(): number;
}

export interface LLMTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function createProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

### Anthropic Provider

Create `src/extension/llm/anthropic.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMResponse, LLMTool, LLMProviderConfig } from './provider';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: LLMProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 8192;
  }

  async complete(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    // Separate system message from conversation
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const conversationMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const requestParams: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemMessage,
      messages: conversationMessages,
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestParams.tools = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      }));
    }

    const response = await this.client.messages.create(requestParams);

    // Extract content and tool calls
    let content = '';
    const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      },
      stopReason: this.mapStopReason(response.stop_reason),
    };
  }

  countTokens(text: string): number {
    // Anthropic provides a token counting API, but for quick estimates:
    // ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  getMaxContextTokens(): number {
    // Claude 3.5 Sonnet and newer support 200k context
    if (this.model.includes('claude-3') || this.model.includes('claude-sonnet-4') || this.model.includes('claude-opus-4')) {
      return 200000;
    }
    return 100000;
  }

  private mapStopReason(reason: string | null): LLMResponse['stopReason'] {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      case 'stop_sequence':
        return 'stop_sequence';
      default:
        return 'end_turn';
    }
  }
}
```

### Context Builder

Create `src/extension/llm/context.ts`:

```typescript
import type { ProjectGraph, ImpactReport, GraphNode, GraphEdge } from '../dag/types';
import type { TaskDefinition, BeadResult } from '../ralph/controller';
import type { LLMProvider } from './provider';

export interface BeadContext {
  task: TaskDefinition;
  beadNumber: number;
  dag: ProjectGraph;
  impact?: ImpactReport;
  previousErrors?: string[];
  previousBeads?: BeadResult[];
  changedFiles?: string[];
}

export interface ContextBudget {
  maxTokens: number;
  reservedForResponse: number;
  reservedForTools: number;
  availableForContext: number;
}

/**
 * Build the context to inject into the LLM prompt.
 * Respects token budget by prioritising high-value context.
 */
export class ContextBuilder {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  /**
   * Calculate available token budget for context.
   */
  calculateBudget(maxResponseTokens: number = 8192): ContextBudget {
    const maxTokens = this.provider.getMaxContextTokens();
    const reservedForResponse = maxResponseTokens;
    const reservedForTools = 2000; // Tool definitions
    const availableForContext = maxTokens - reservedForResponse - reservedForTools;

    return {
      maxTokens,
      reservedForResponse,
      reservedForTools,
      availableForContext,
    };
  }

  /**
   * Build the system prompt with DAG context.
   */
  buildSystemPrompt(context: BeadContext, budget: ContextBudget): string {
    const sections: string[] = [];

    // Base instructions
    sections.push(this.buildBaseInstructions(context));

    // DAG summary (always include, low token cost)
    sections.push(this.buildDAGSummary(context.dag));

    // Calculate remaining budget
    let usedTokens = this.provider.countTokens(sections.join('\n'));
    let remainingTokens = budget.availableForContext - usedTokens;

    // Impact analysis (high priority if available)
    if (context.impact && remainingTokens > 500) {
      const impactSection = this.buildImpactSection(context.impact);
      const impactTokens = this.provider.countTokens(impactSection);
      if (impactTokens <= remainingTokens) {
        sections.push(impactSection);
        remainingTokens -= impactTokens;
      }
    }

    // Previous errors (high priority for retry beads)
    if (context.previousErrors && context.previousErrors.length > 0 && remainingTokens > 300) {
      const errorSection = this.buildErrorSection(context.previousErrors);
      const errorTokens = this.provider.countTokens(errorSection);
      if (errorTokens <= remainingTokens) {
        sections.push(errorSection);
        remainingTokens -= errorTokens;
      }
    }

    // Relevant file dependencies (fill remaining budget)
    if (remainingTokens > 1000) {
      const dependencySection = this.buildDependencySection(context, remainingTokens);
      sections.push(dependencySection);
    }

    return sections.join('\n\n');
  }

  private buildBaseInstructions(context: BeadContext): string {
    return `# Task: ${context.task.description}

## Bead ${context.beadNumber}

You are working on a discrete unit of work called a "bead". Your goal is to make focused, testable changes that move toward completing the task.

### Success Criteria
${context.task.successCriteria.map(c => `- ${c.type}${c.config ? `: ${JSON.stringify(c.config)}` : ''}`).join('\n')}

### Guidelines
1. Make small, focused changes
2. Consider the dependency graph before modifying files
3. If a change might break dependent code, note it explicitly
4. Run tests when available
5. When complete, include "DONE" in your response

### Token Budget
- Remaining for this task: ${context.task.tokenBudget} tokens
- This is bead ${context.beadNumber} of maximum ${context.task.maxIterations}`;
  }

  private buildDAGSummary(dag: ProjectGraph): string {
    return `## Project Dependency Summary

- Files analysed: ${dag.summary.files}
- Functions tracked: ${dag.summary.functions}
- Dependencies: ${dag.summary.edges}
  - High confidence: ${dag.summary.highConfidenceEdges}
  - Medium confidence: ${dag.summary.mediumConfidenceEdges}
  - Low confidence: ${dag.summary.lowConfidenceEdges}
  - Unsafe (dynamic): ${dag.summary.unsafeEdges}

${dag.warnings.length > 0 ? `### Warnings\n${dag.warnings.slice(0, 5).map(w => `- ${w.file}:${w.line}: ${w.description}`).join('\n')}` : ''}`;
  }

  private buildImpactSection(impact: ImpactReport): string {
    return `## Impact Analysis for ${impact.changedFile}

### Files That May Be Affected
${impact.affectedFiles.slice(0, 10).map(f => `- ${f}`).join('\n')}
${impact.affectedFiles.length > 10 ? `\n... and ${impact.affectedFiles.length - 10} more files` : ''}

### Functions That May Be Affected
${impact.affectedFunctions.slice(0, 10).map(f => `- ${f}`).join('\n')}
${impact.affectedFunctions.length > 10 ? `\n... and ${impact.affectedFunctions.length - 10} more functions` : ''}

### Suggested Tests to Run
${impact.suggestedTests.slice(0, 5).map(t => `- ${t}`).join('\n')}

### Confidence Breakdown
- High confidence edges: ${impact.confidenceBreakdown.high || 0}
- Medium confidence edges: ${impact.confidenceBreakdown.medium || 0}
- Low confidence edges: ${impact.confidenceBreakdown.low || 0}
- Unsafe edges: ${impact.confidenceBreakdown.unsafe || 0}

**Note:** Low confidence and unsafe edges indicate dynamic or duck-typed code. Exercise extra caution when modifying code with these dependencies.`;
  }

  private buildErrorSection(errors: string[]): string {
    return `## Previous Errors (From Last Attempt)

The following errors occurred in the previous iteration. Please address them:

${errors.map((e, i) => `### Error ${i + 1}\n\`\`\`\n${e}\n\`\`\``).join('\n\n')}`;
  }

  private buildDependencySection(context: BeadContext, tokenBudget: number): string {
    // Find the most relevant nodes based on:
    // 1. Recently changed files
    // 2. Files in the impact report
    // 3. High-connectivity nodes (likely important)

    const relevantNodes: GraphNode[] = [];
    const relevantEdges: GraphEdge[] = [];

    // Prioritise changed files
    if (context.changedFiles) {
      for (const file of context.changedFiles) {
        const fileNode = context.dag.nodes.find(n => n.filePath === file);
        if (fileNode) {
          relevantNodes.push(fileNode);
        }

        // Add edges to/from this file
        const edges = context.dag.edges.filter(
          e => e.fromNode.startsWith(file) || e.toNode.startsWith(file)
        );
        relevantEdges.push(...edges);
      }
    }

    // Add impacted files
    if (context.impact) {
      for (const file of context.impact.affectedFiles.slice(0, 5)) {
        const fileNode = context.dag.nodes.find(n => n.filePath === file);
        if (fileNode && !relevantNodes.find(n => n.id === fileNode.id)) {
          relevantNodes.push(fileNode);
        }
      }
    }

    // Build the section
    let section = `## Relevant Dependencies\n\n`;

    // Add node summaries
    section += `### Key Files\n`;
    for (const node of relevantNodes.slice(0, 10)) {
      section += `- **${node.name}** (${node.type}) at ${node.filePath}:${node.lineNumber}\n`;
      if (node.docstring) {
        section += `  ${node.docstring.slice(0, 100)}${node.docstring.length > 100 ? '...' : ''}\n`;
      }
    }

    // Add edge summaries
    section += `\n### Key Dependencies\n`;
    const highConfidenceEdges = relevantEdges.filter(e => e.confidence === 'high').slice(0, 15);
    for (const edge of highConfidenceEdges) {
      section += `- ${edge.fromNode} → ${edge.toNode} (${edge.edgeType})\n`;
    }

    // Check if we're within budget
    const sectionTokens = this.provider.countTokens(section);
    if (sectionTokens > tokenBudget) {
      // Truncate to fit
      const ratio = tokenBudget / sectionTokens;
      const truncatedLength = Math.floor(section.length * ratio * 0.9);
      section = section.slice(0, truncatedLength) + '\n\n[Truncated due to token budget]';
    }

    return section;
  }
}
```

### Bead Executor

Create `src/extension/llm/executor.ts`:

```typescript
import * as vscode from 'vscode';
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse } from './provider';
import type { DAGBridge } from '../dag/bridge';
import type { TaskDefinition, BeadResult } from '../ralph/controller';
import { ContextBuilder, type BeadContext } from './context';

export interface FileChange {
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  content?: string;
  diff?: string;
}

export interface ExecutionResult {
  success: boolean;
  filesChanged: FileChange[];
  errors: string[];
  tokensUsed: number;
  response: string;
  isDone: boolean;
}

/**
 * Execute a single bead by calling the LLM and processing the response.
 */
export class BeadExecutor {
  private provider: LLMProvider;
  private dagBridge: DAGBridge;
  private contextBuilder: ContextBuilder;

  constructor(provider: LLMProvider, dagBridge: DAGBridge) {
    this.provider = provider;
    this.dagBridge = dagBridge;
    this.contextBuilder = new ContextBuilder(provider);
  }

  /**
   * Execute a bead and return the result.
   */
  async execute(
    task: TaskDefinition,
    beadNumber: number,
    previousErrors?: string[],
    previousBeads?: BeadResult[]
  ): Promise<ExecutionResult> {
    // Get current DAG
    const dag = await this.dagBridge.analyseProject(task.workspaceRoot);

    // Build context
    const context: BeadContext = {
      task,
      beadNumber,
      dag,
      previousErrors,
      previousBeads,
    };

    const budget = this.contextBuilder.calculateBudget();
    const systemPrompt = this.contextBuilder.buildSystemPrompt(context, budget);

    // Build messages
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: this.buildUserPrompt(task, beadNumber, previousBeads) },
    ];

    // Define tools
    const tools = this.buildTools();

    // Call LLM
    let totalTokens = 0;
    const filesChanged: FileChange[] = [];
    const errors: string[] = [];
    let isDone = false;
    let responseContent = '';

    try {
      // Agentic loop: keep processing until done or error
      let iterations = 0;
      const maxIterations = 10;

      while (iterations < maxIterations) {
        iterations++;

        const response = await this.provider.complete(messages, tools);
        totalTokens += response.tokensUsed.total;
        responseContent += response.content;

        // Check for DONE marker
        if (response.content.includes('DONE')) {
          isDone = true;
        }

        // Process tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Add assistant message with tool calls
          messages.push({ role: 'assistant', content: response.content });

          // Process each tool call
          for (const toolCall of response.toolCalls) {
            const toolResult = await this.processToolCall(
              toolCall,
              task.workspaceRoot,
              filesChanged,
              errors
            );

            // Add tool result as user message
            messages.push({
              role: 'user',
              content: `Tool result for ${toolCall.name}:\n${toolResult}`,
            });
          }
        } else {
          // No tool calls, we're done with this iteration
          break;
        }

        // Check stop reason
        if (response.stopReason === 'end_turn' && !response.toolCalls) {
          break;
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    return {
      success: errors.length === 0,
      filesChanged,
      errors,
      tokensUsed: totalTokens,
      response: responseContent,
      isDone,
    };
  }

  private buildUserPrompt(
    task: TaskDefinition,
    beadNumber: number,
    previousBeads?: BeadResult[]
  ): string {
    let prompt = `Please work on the next step of the task: "${task.description}"

This is bead ${beadNumber}. `;

    if (previousBeads && previousBeads.length > 0) {
      const lastBead = previousBeads[previousBeads.length - 1];
      prompt += `\n\nIn the previous bead, you made the following changes:\n`;
      prompt += lastBead.filesChanged.map(f => `- ${f}`).join('\n');

      if (!lastBead.success) {
        prompt += `\n\nThe previous bead encountered errors that need to be addressed.`;
      }
    }

    prompt += `\n\nUse the available tools to read files, make changes, and run commands as needed. When you have completed a meaningful unit of work, include "DONE" in your response.`;

    return prompt;
  }

  private buildTools(): LLMTool[] {
    return [
      {
        name: 'read_file',
        description: 'Read the contents of a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The path to the file to read, relative to workspace root',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file (creates or overwrites)',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The path to the file to write',
            },
            content: {
              type: 'string',
              description: 'The content to write to the file',
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'edit_file',
        description: 'Make a targeted edit to a file by replacing a specific string',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The path to the file to edit',
            },
            old_string: {
              type: 'string',
              description: 'The exact string to find and replace',
            },
            new_string: {
              type: 'string',
              description: 'The string to replace it with',
            },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
      {
        name: 'run_command',
        description: 'Run a shell command in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The command to run',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'list_files',
        description: 'List files in a directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The directory path to list',
            },
            pattern: {
              type: 'string',
              description: 'Optional glob pattern to filter files',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'get_impact',
        description: 'Get the impact analysis for a file from the dependency graph',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to analyse',
            },
          },
          required: ['path'],
        },
      },
    ];
  }

  private async processToolCall(
    toolCall: { name: string; arguments: Record<string, unknown> },
    workspaceRoot: string,
    filesChanged: FileChange[],
    errors: string[]
  ): Promise<string> {
    const args = toolCall.arguments;

    try {
      switch (toolCall.name) {
        case 'read_file': {
          const filePath = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
          const content = await vscode.workspace.fs.readFile(filePath);
          return new TextDecoder().decode(content);
        }

        case 'write_file': {
          const filePath = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
          const content = args.content as string;

          // Check if file exists
          let changeType: 'create' | 'modify' = 'create';
          try {
            await vscode.workspace.fs.stat(filePath);
            changeType = 'modify';
          } catch {
            // File doesn't exist
          }

          await vscode.workspace.fs.writeFile(filePath, new TextEncoder().encode(content));
          filesChanged.push({
            filePath: args.path as string,
            changeType,
            content,
          });

          return `File ${changeType === 'create' ? 'created' : 'updated'}: ${args.path}`;
        }

        case 'edit_file': {
          const filePath = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
          const existingContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(filePath)
          );

          const oldString = args.old_string as string;
          const newString = args.new_string as string;

          if (!existingContent.includes(oldString)) {
            return `Error: Could not find the specified string in ${args.path}`;
          }

          const newContent = existingContent.replace(oldString, newString);
          await vscode.workspace.fs.writeFile(filePath, new TextEncoder().encode(newContent));

          filesChanged.push({
            filePath: args.path as string,
            changeType: 'modify',
            content: newContent,
            diff: `- ${oldString}\n+ ${newString}`,
          });

          return `File edited: ${args.path}`;
        }

        case 'run_command': {
          const command = args.command as string;

          // Security: basic command validation
          const dangerousPatterns = ['rm -rf /', 'sudo', ':(){ :|:& };:'];
          for (const pattern of dangerousPatterns) {
            if (command.includes(pattern)) {
              return `Error: Command blocked for safety: ${command}`;
            }
          }

          // Execute via VS Code terminal
          const terminal = vscode.window.createTerminal({
            name: 'Cline+ Bead',
            cwd: workspaceRoot,
          });

          // For now, return a placeholder - actual implementation would
          // capture terminal output via a pseudo-terminal or task API
          terminal.sendText(command);
          return `Command executed: ${command}\n(Check terminal for output)`;
        }

        case 'list_files': {
          const dirPath = vscode.Uri.file(`${workspaceRoot}/${args.path || ''}`);
          const entries = await vscode.workspace.fs.readDirectory(dirPath);

          const pattern = args.pattern as string | undefined;
          let files = entries.map(([name, type]) => ({
            name,
            type: type === vscode.FileType.Directory ? 'dir' : 'file',
          }));

          if (pattern) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            files = files.filter(f => regex.test(f.name));
          }

          return files.map(f => `${f.type === 'dir' ? '[DIR]' : '     '} ${f.name}`).join('\n');
        }

        case 'get_impact': {
          const impact = await this.dagBridge.getImpact(
            `${workspaceRoot}/${args.path}`
          );

          return `Impact analysis for ${args.path}:
Affected files: ${impact.affectedFiles.length}
${impact.affectedFiles.slice(0, 5).map(f => `  - ${f}`).join('\n')}
Suggested tests: ${impact.suggestedTests.slice(0, 3).join(', ')}`;
        }

        default:
          return `Unknown tool: ${toolCall.name}`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Tool ${toolCall.name} failed: ${message}`);
      return `Error: ${message}`;
    }
  }
}
```

## Token Management

### Counting Strategy

| Provider | Method | Accuracy |
|----------|--------|----------|
| Anthropic | Native API counting | Exact |
| OpenAI | tiktoken library | Exact |
| Ollama | Character estimation | ~90% |

### Budget Enforcement

```typescript
interface TokenBudget {
  total: number;           // Total budget for the task
  used: number;            // Tokens used so far
  remaining: number;       // Tokens remaining
  perBead: number;         // Estimated per-bead allowance
  warningThreshold: number; // When to warn user
}

function checkBudget(budget: TokenBudget, nextRequestEstimate: number): boolean {
  if (budget.remaining < nextRequestEstimate) {
    // Not enough tokens for next request
    return false;
  }

  if (budget.remaining < budget.warningThreshold) {
    // Warn user but allow continuation
    vscode.window.showWarningMessage(
      `Token budget running low: ${budget.remaining} tokens remaining`
    );
  }

  return true;
}
```

## Error Handling

### Retry Strategy

| Error Type | Retry? | Max Retries | Backoff |
|------------|--------|-------------|---------|
| Rate limit (429) | Yes | 3 | Exponential |
| Server error (5xx) | Yes | 2 | Linear |
| Context too long | No | - | Reduce context |
| Invalid request | No | - | Log and fail |
| Network error | Yes | 3 | Exponential |

### Implementation

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; initialDelay: number }
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if retryable
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      if (attempt < options.maxRetries) {
        const delay = options.initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('network') ||
    message.includes('timeout')
  );
}
```

## Security Considerations

### API Key Storage

- Store API keys using VS Code's `SecretStorage` API
- Never log API keys or include in error reports
- Clear keys from memory when extension deactivates

### Prompt Injection Prevention

- Validate all user input before including in prompts
- Escape special characters in file contents
- Limit context size to prevent injection via large files

### Command Execution Safety

- Whitelist allowed commands or require user approval
- Run commands in workspace directory only
- Block dangerous patterns (rm -rf, sudo, etc.)

---

**Document Version:** 1.0
**Last Updated:** 28 January 2026
