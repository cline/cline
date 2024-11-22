export interface ApiHandler {
  sendMessage(message: string): Promise<string>;
  createMessage(systemPrompt: string, history: Message[]): AsyncIterable<MessageChunk>;
}

export interface AgentConfig {
  api: ApiHandler;
  systemPrompt: string;
  workingDir: string;
  debug?: boolean;
}

export type ToolResponse = string;

export interface Message {
  role: "user" | "assistant";
  content: TextBlock[];
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolResult {
  tool: string;
  params: Record<string, string>;
  output: string;
}

export interface MessageChunk {
  type: "text";
  text: string;
}

export interface UsageBlock {
  type: "usage";
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
