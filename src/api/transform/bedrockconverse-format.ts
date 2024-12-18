import { ToolConfiguration } from "@aws-sdk/client-bedrock-runtime";
import { BedrockConverseModelId, bedrockConverseDefaultModelId, bedrockConverseModels } from "../../shared/api";

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
  awsUseCrossRegionInference?: boolean;
  awsRegion?: string;
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

  const finalModelId = modelId || bedrockConverseDefaultModelId;
  const modelInfo = bedrockConverseModels[finalModelId];

  const request: BedrockConverseRequest = {
    modelId: finalModelId,
    messages: bedrockMessages,
  };

  if (options) {
    // Only include inferenceConfiguration if:
    // 1. The model supports inference profiles AND
    // 2. Cross-region inference is enabled (which also controls inference profiles)
    if (modelInfo.supportsInferenceProfile && options.awsUseCrossRegionInference) {
      request.inferenceConfiguration = {
        temperature: options.temperature,
        topP: options.top_p,
        maxTokens: options.max_tokens,
        stopSequences: options.stop,
      };

      // Only modify modelId for cross-region inference if the model supports it
      if (options.awsRegion) {
        let regionPrefix = options.awsRegion.slice(0, 3);
        switch (regionPrefix) {
          case "us-":
            request.modelId = `us.${finalModelId}`;
            break;
          case "eu-":
            request.modelId = `eu.${finalModelId}`;
            break;
          // cross region inference is not supported in other regions, keep default model ID
        }
      }
    }

    // Include toolConfig if provided
    if (options.toolConfig) {
      request.toolConfig = options.toolConfig;
    }
  }

  return request;
}
