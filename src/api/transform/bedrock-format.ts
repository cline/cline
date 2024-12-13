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

export interface BedrockConverseResponse {
  output?: {
    message?: {
      content?: { text?: string }[];
    };
    stopReason?: 'content_filtered' | 'end_turn' | 'guardrail_intervened' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  metrics?: {
    latencyMs?: number;
  };
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

export function convertBedrockResponseToAnthropic(response: BedrockConverseResponse): Anthropic.Messages.Message {
  const content: Anthropic.Messages.ContentBlock[] = [];

  if (response.output?.message?.content) {
    for (const contentBlock of response.output.message.content) {
      if (contentBlock.text) {
        content.push({ type: "text", text: contentBlock.text });
      }
    }
  }

  // Map Bedrock Converse stop reasons to Anthropic stop reasons
  let stop_reason: Anthropic.Messages.Message["stop_reason"] = null;
  if (response.output?.stopReason) {
    switch (response.output.stopReason) {
      case 'end_turn':
        stop_reason = 'end_turn';
        break;
      case 'max_tokens':
        stop_reason = 'max_tokens';
        break;
      case 'stop_sequence':
        stop_reason = 'stop_sequence';
        break;
      case 'content_filtered':
      case 'guardrail_intervened':
      case 'tool_use':
        // These don't have direct mappings in Anthropic's types, 
        // but stop_sequence is the closest semantic match
        stop_reason = 'stop_sequence';
        break;
    }
  }

  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content,
    model: "",
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
    },
  };
}
