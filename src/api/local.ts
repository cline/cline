import { Anthropic } from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { ApiHandler, ApiHandlerMessageResponse, withoutImageData } from ".";
import {
  ApiHandlerOptions,
  ModelInfo,
  openRouterDefaultModelId,
  OpenRouterModelId,
  openRouterModels,
} from "../shared/api";
import { convertToOpenAiMessages } from "../utils/openai-format";
import axios from "axios";

export class LocalHandler implements ApiHandler {
  private options: ApiHandlerOptions;

  constructor(options: ApiHandlerOptions) {
    this.options = options;
  }

  async createMessage(
    systemPrompt: string,
    messages: Anthropic.Messages.MessageParam[],
    tools: Anthropic.Messages.Tool[]
  ): Promise<ApiHandlerMessageResponse> {
    // Convert Anthropic messages to OpenAI format
    const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...convertToOpenAiMessages(messages),
    ];

    // Convert Anthropic tools to OpenAI tools
    const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema, // matches anthropic tool input schema (see https://platform.openai.com/docs/guides/function-calling)
      },
    }));

    const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
        model: this.getModel().id,
        // max_tokens: this.getModel().info.maxTokens,
        messages: openAiMessages,
        tools: openAiTools,
        tool_choice: "auto",
      };

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    // try {
    // 	completion = await axios.post("http://localhost:1337/v1/chat/completions", {...createParams,
    // 		model: "llama3-8b-instruct" })
    // } catch (error) {
    // 	console.error("Error creating message from normal request. Using streaming fallback...", error)
    completion = await this.streamCompletion(createParams);
    // }

    const errorMessage = (completion as any).error?.message; // openrouter returns an error object instead of the openai sdk throwing an error
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    // Convert OpenAI response to Anthropic format
    const openAiMessage = completion.choices[0].message;
    const anthropicMessage: Anthropic.Messages.Message = {
      id: completion.id,
      type: "message",
      role: openAiMessage.role, // always "assistant"
      content: [
        {
          type: "text",
          text: openAiMessage.content || "",
        },
      ],
      model: completion.model,
      stop_reason: (() => {
        switch (completion.choices[0].finish_reason) {
          case "stop":
            return "end_turn";
          case "length":
            return "max_tokens";
          case "tool_calls":
            return "tool_use";
          case "content_filter": // Anthropic doesn't have an exact equivalent
          default:
            return null;
        }
      })(),
      stop_sequence: null, // which custom stop_sequence was generated, if any (not applicable if you don't use stop_sequence)
      usage: {
        input_tokens: completion.usage?.prompt_tokens || 0,
        output_tokens: completion.usage?.completion_tokens || 0,
      },
    };

    if (openAiMessage.tool_calls && openAiMessage.tool_calls.length > 0) {
      anthropicMessage.content.push(
        ...openAiMessage.tool_calls.map((toolCall): Anthropic.ToolUseBlock => {
          let parsedInput = {};
          try {
            parsedInput = JSON.parse(toolCall.function.arguments || "{}");
          } catch (error) {
            console.error("Failed to parse tool arguments:", error);
          }
          return {
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: parsedInput,
          };
        })
      );
    }

    return { message: anthropicMessage };
  }

  /*
	Streaming the completion is a fallback behavior for when a normal request responds with an invalid JSON object ("Unexpected end of JSON input"). This would usually happen in cases where the model makes tool calls with large arguments. After talking with OpenRouter folks, streaming mitigates this issue for now until they fix the underlying problem ("some weird data from anthropic got decoded wrongly and crashed the buffer")
	*/
  async streamCompletion(
    createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const res = await axios.post("http://localhost:1337/v1/chat/completions", {
      ...createParams,
      messages: createParams.messages.map((m) => ({
        ...m,
        content: Array.isArray(m.content)
          ? (m.content[0] as any).text
          : m.content,
      })),
      model: "mistral-ins-7b-q4",
      stream: false,
    });

    console.log(res.data);

    let textContent: string = res.data.choices[0].message.content;
    let toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];

    const r = await axios.post("http://localhost:1337/v1/chat/completions", {
      messages: [
        {
          role: "user",
          content: `HERE IS THE DESCRIBED TASK:

${textContent}

HERE ARE FUNCTION SIGNATURES:

${JSON.stringify(createParams.tools)}

EXTRACT, SELECT AND FORMAT EACH FUNCTION FROM THE TASK AS A {"arguments": <args-dict>, "name": <function-name>}.
THE FUNCTION ARGUMENtS ARE DESCRIBED IN THE input_schema.properties PROPERTY PATH
THE FUNCTION REQUIRED ARGUMENTS ARE STATED IN THE input_schema.required PROPERTY PATH
REPLACE THE ARGUMENT VALUES WITH THE TASK VALUES
DO NOT ASSUME FUNCTION NAMES

OUTPUT A JSON ARRAY ONLY, NO EXPLANATION, OF THE FUNCTIONS:`,
        },
      ],
      model: "mistral-ins-7b-q4",
      stream: false,
    });

    console.log(r.data.choices[0].message.content.split("</s>")[0]);

    toolCalls = JSON.parse(
      r.data.choices[0].message.content.split("</s>")[0]
    ).map((t: any) => ({
      id: (Math.random() + "").split(".")[1],
      type: "function",
      function: {
        name: t.name,
        arguments:
          typeof t.arguments === "string"
            ? t.arguments
            : JSON.stringify(t.arguments),
      },
    }));

    console.log("toolCalls", toolCalls);

    console.log("END");
    // if (currentToolCall) {
    // 	toolCalls.push(currentToolCall)
    // }

    // Usage information is not available in streaming responses, so we need to estimate token counts
    function approximateTokenCount(text: string): number {
      return Math.ceil(new TextEncoder().encode(text).length / 4);
    }
    const promptTokens = approximateTokenCount(
      createParams.messages
        .map((m) =>
          typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        )
        .join(" ")
    );
    const completionTokens = approximateTokenCount(
      textContent +
        toolCalls.map((toolCall) => toolCall.function.arguments || "").join(" ")
    );

    const completion: OpenAI.Chat.Completions.ChatCompletion = {
      created: Date.now(),
      object: "chat.completion",
      id: `openrouter-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`, // this ID won't be traceable back to OpenRouter's systems if you need to debug issues
      choices: [
        {
          message: {
            role: "assistant",
            content: textContent,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
          index: 0,
          logprobs: null,
        },
      ],
      model: this.getModel().id,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };

    return completion;
  }

  createUserReadableRequest(
    userContent: Array<
      | Anthropic.TextBlockParam
      | Anthropic.ImageBlockParam
      | Anthropic.ToolUseBlockParam
      | Anthropic.ToolResultBlockParam
    >
  ): any {
    return {
      model: this.getModel().id,
      max_tokens: this.getModel().info.maxTokens,
      system: "(see SYSTEM_PROMPT in src/ClaudeDev.ts)",
      messages: [
        { conversation_history: "..." },
        { role: "user", content: withoutImageData(userContent) },
      ],
      tools: "(see tools in src/ClaudeDev.ts)",
      tool_choice: "auto",
    };
  }

  getModel(): { id: OpenRouterModelId; info: ModelInfo } {
    const modelId = this.options.apiModelId;
    if (modelId && modelId in openRouterModels) {
      const id = modelId as OpenRouterModelId;
      return { id, info: openRouterModels[id] };
    }
    return {
      id: openRouterDefaultModelId,
      info: openRouterModels[openRouterDefaultModelId],
    };
  }
}
