import { ToolResponse } from "./ToolResponse";
import { ToolName } from "./Tool";


export interface ToolExecutions {
  executeTool(toolName: ToolName, toolInput: any): Promise<ToolResponse>;
  executeCommand(command?: string, returnEmptyStringOnSuccess?: boolean): Promise<ToolResponse>;
  askFollowupQuestion(question?: string): Promise<ToolResponse>;
  attemptCompletion(result?: string, command?: string): Promise<ToolResponse>;
}
