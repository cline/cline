import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";
import { ResultPromise } from "execa";
import { ApiHandler } from "../api";
import { ApiConfiguration } from "./api";
import { ToolResponse } from "./ToolResponse";
import { ClaudeAsk, ClaudeSay, ClaudeMessage } from "./ExtensionMessage";
import { ToolName } from "./Tool";
import { ClaudeAskResponse } from "./WebviewMessage";


export interface ClaudeDevCore {
  ask(type: ClaudeAsk, question?: string): Promise<{ response: ClaudeAskResponse; text?: string; images?: string[]; }>;
  say(type: ClaudeSay, text?: string, images?: string[]): Promise<undefined>;
  handleWebviewAskResponse(askResponse: ClaudeAskResponse, text?: string, images?: string[]): Promise<void>;
  updateApi(apiConfiguration: ApiConfiguration): void;
  updateMaxRequestsPerTask(maxRequestsPerTask: number | undefined): void;
  updateCustomInstructions(customInstructions: string | undefined): void;
  updateAlwaysAllowReadOnly(alwaysAllowReadOnly: boolean | undefined): void;
  abortTask(): void;
  alwaysAllowReadOnly: boolean;
  cwd: string;
  customInstructions?: string;
  claudeMessages: ClaudeMessage[];
  api: ApiHandler;
  maxRequestsPerTask: number;
  requestCount: number;
  apiConversationHistory: Anthropic.MessageParam[];
  shouldSkipNextApiReqStartedMessage: boolean;
  abort: boolean;
  executeCommandRunningProcess?: ResultPromise;
  addToApiConversationHistory(message: Anthropic.MessageParam): Promise<void>;
  overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]): Promise<void>;
  calculateApiCost(inputTokens: number, outputTokens: number, cacheCreationInputTokens?: number, cacheReadInputTokens?: number): number;
  executeTool(toolName: ToolName, toolInput: any): Promise<ToolResponse>;
  writeToFile(relPath?: string, newContent?: string): Promise<ToolResponse>;
  readFile(relPath?: string): Promise<ToolResponse>;
  listFiles(relDirPath?: string, recursiveRaw?: string): Promise<ToolResponse>;
  listCodeDefinitionNames(relDirPath?: string): Promise<ToolResponse>;
  searchFiles(relDirPath: string, regex: string, filePattern?: string): Promise<ToolResponse>;
  formatIntoToolResponse(text: string, images?: string[]): ToolResponse;
  formatGenericToolFeedback(feedback?: string): Promise<string>;
}
