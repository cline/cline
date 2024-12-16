import { ToolConfiguration } from "@aws-sdk/client-bedrock-runtime";
import { BedrockConverseModelId, bedrockConverseDefaultModelId } from "../../shared/api";
import { Anthropic } from "@anthropic-ai/sdk";

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface BedrockConverseMessage {
  role: 'user' | 'assistant';
  content: { text: string }[];
}

export interface BedrockConverseRequest {
  modelId: string;
  messages: BedrockConverseMessage[];
  inferenceConfiguration?: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    stopSequences?: string[];
  };
  toolConfig?: ToolConfiguration;
}

interface ConversionOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  toolConfig?: ToolConfiguration;
}

export function convertToBedrock(
  messages: Message[],
  modelId: BedrockConverseModelId | undefined,
  options: ConversionOptions
): BedrockConverseRequest {
  const systemMessage = messages.find(msg => msg.role === 'system');
  const otherMessages = messages.filter(msg => msg.role !== 'system');

  const bedrockMessages: BedrockConverseMessage[] = [];
  
  for (let i = 0; i < otherMessages.length; i++) {
    const msg = otherMessages[i];
    if (msg.role === 'user' && i === 0 && systemMessage) {
      bedrockMessages.push({
        role: 'user',
        content: [{ text: `${systemMessage.content}\n\n${msg.content}` }],
      });
    } else {
      const role: 'user' | 'assistant' = msg.role === 'user' ? 'user' : 'assistant';
      bedrockMessages.push({
        role,
        content: [{ text: msg.content }],
      });
    }
  }

  return {
    modelId: modelId || bedrockConverseDefaultModelId,
    messages: bedrockMessages,
    ...(options && {
      inferenceConfiguration: {
        temperature: options.temperature,
        topP: options.top_p,
        maxTokens: options.max_tokens,
        stopSequences: options.stop,
      },
      ...(options.toolConfig && { toolConfig: options.toolConfig }),
    }),
  };
}
