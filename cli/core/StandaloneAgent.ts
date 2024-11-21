import { blue, red, yellow } from "../deps.ts";
import { ApiHandler } from "../api/mod.ts";
import { executeCommand, readFile, writeFile, searchFiles, listFiles, listCodeDefinitions } from "../tools/mod.ts";
import type { Message, TextBlock, ToolResult } from "../types.d.ts";

interface AgentConfig {
  api: ApiHandler;
  systemPrompt: string;
  workingDir: string;
}

export class StandaloneAgent {
  private api: ApiHandler;
  private systemPrompt: string;
  private workingDir: string;
  private conversationHistory: Message[] = [];

  constructor(config: AgentConfig) {
    this.api = config.api;
    this.systemPrompt = config.systemPrompt;
    this.workingDir = config.workingDir;
  }

  async runTask(task: string): Promise<void> {
    this.conversationHistory.push({
      role: "user",
      content: [{ type: "text", text: `<task>\n${task}\n</task>` }]
    });

    let isTaskComplete = false;
    const encoder = new TextEncoder();
    
    while (!isTaskComplete) {
      const stream = this.api.createMessage(this.systemPrompt, this.conversationHistory);
      let assistantMessage = "";
      
      console.log(blue("Thinking..."));
      for await (const chunk of stream) {
        if (chunk.type === "text") {
          assistantMessage += chunk.text;
          await Deno.stdout.write(encoder.encode(chunk.text));
        }
      }

      this.conversationHistory.push({
        role: "assistant",
        content: [{ type: "text", text: assistantMessage }]
      });

      const toolResults = await this.executeTools(assistantMessage);
      
      if (toolResults.length > 0) {
        this.conversationHistory.push({
          role: "user",
          content: toolResults.map(result => ({
            type: "text",
            text: `[${result.tool}] Result:${result.output}`
          })) as TextBlock[]
        });
      } else {
        if (assistantMessage.includes("<attempt_completion>")) {
          isTaskComplete = true;
        } else {
          this.conversationHistory.push({
            role: "user",
            content: [{
              type: "text",
              text: "You must either use available tools to accomplish the task or call attempt_completion when the task is complete."
            }]
          });
        }
      }
    }
  }

  private async executeTools(message: string): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    const toolRegex = /<(\w+)>\s*([\s\S]*?)\s*<\/\1>/g;
    let match;
    
    while ((match = toolRegex.exec(message)) !== null) {
      const [_, toolName, paramsXml] = match;
      const params: Record<string, string> = {};
      const paramRegex = /<(\w+)>\s*([\s\S]*?)\s*<\/\1>/g;
      let paramMatch;
      
      while ((paramMatch = paramRegex.exec(paramsXml)) !== null) {
        const [__, paramName, paramValue] = paramMatch;
        params[paramName] = paramValue.trim();
      }

      let output: string;
      try {
        console.log(yellow(`\nExecuting: ${this.getToolDescription(toolName, params)}`));
        
        switch (toolName) {
          case "execute_command":
            output = await executeCommand(params.command);
            break;
          case "read_file":
            output = await readFile(this.workingDir, params.path);
            break;
          case "write_to_file":
            output = await writeFile(this.workingDir, params.path, params.content);
            break;
          case "search_files":
            output = await searchFiles(this.workingDir, params.path, params.regex, params.file_pattern);
            break;
          case "list_files":
            output = await listFiles(this.workingDir, params.path, params.recursive === "true");
            break;
          case "list_code_definition_names":
            output = await listCodeDefinitions(this.workingDir, params.path);
            break;
          case "attempt_completion":
            return results;
          default:
            console.warn(red(`Unknown tool: ${toolName}`));
            continue;
        }

        results.push({
          tool: toolName,
          params,
          output: output || "(No output)"
        });

        break;
      } catch (error) {
        const errorMessage = `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(red(errorMessage));
        results.push({
          tool: toolName,
          params,
          output: errorMessage
        });
        break;
      }
    }

    return results;
  }

  private getToolDescription(toolName: string, params: Record<string, string>): string {
    switch (toolName) {
      case "execute_command":
        return `Running command: ${params.command}`;
      case "read_file":
        return `Reading file: ${params.path}`;
      case "write_to_file":
        return `Writing to file: ${params.path}`;
      case "search_files":
        return `Searching for "${params.regex}" in ${params.path}`;
      case "list_files":
        return `Listing files in ${params.path}`;
      case "list_code_definition_names":
        return `Analyzing code in ${params.path}`;
      case "attempt_completion":
        return "Completing task";
      default:
        return toolName;
    }
  }
}
