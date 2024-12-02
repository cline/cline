import type { ApiStream, ModelInfo, Message, TextBlock } from "../../types.d.ts";

interface OpenRouterOptions {
  model: string;
  apiKey: string;
}

export class OpenRouterHandler {
  private apiKey: string;
  private model: string;

  constructor(options: OpenRouterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async *createMessage(systemPrompt: string, messages: Message[]): ApiStream {
    try {
      // Convert our messages to OpenRouter format
      const openRouterMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map(msg => ({
          role: msg.role,
          content: Array.isArray(msg.content)
            ? msg.content.map(c => c.text).join("\n")
            : msg.content
        }))
      ];

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
          "X-Title": "Roo Cline"
        },
        body: JSON.stringify({
          model: this.model,
          messages: openRouterMessages,
          stream: true,
          temperature: 0.7,
          max_tokens: 4096
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(`OpenRouter API error: ${response.statusText}${errorData ? ` - ${JSON.stringify(errorData)}` : ""}`);
      }

      if (!response.body) {
        throw new Error("No response body received");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Add new chunk to buffer and split into lines
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        
        // Process all complete lines
        buffer = lines.pop() || ""; // Keep the last incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim() === "") continue;
          if (line === "data: [DONE]") continue;
          
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta?.content) {
                const text = data.choices[0].delta.content;
                content += text;
                yield { type: "text", text };
              }
            } catch (e) {
              // Ignore parse errors for incomplete chunks
              continue;
            }
          }
        }
      }

      // Process any remaining content in buffer
      if (buffer.trim() && buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6));
          if (data.choices?.[0]?.delta?.content) {
            const text = data.choices[0].delta.content;
            content += text;
            yield { type: "text", text };
          }
        } catch (e) {
          // Ignore parse errors for final incomplete chunk
        }
      }

      // Estimate token usage (4 chars per token is a rough estimate)
      const inputText = systemPrompt + messages.reduce((acc, msg) => 
        acc + (typeof msg.content === "string" ? 
          msg.content : 
          msg.content.reduce((a, b) => a + b.text, "")), "");

      const inputTokens = Math.ceil(inputText.length / 4);
      const outputTokens = Math.ceil(content.length / 4);

      yield {
        type: "usage",
        inputTokens,
        outputTokens,
        totalCost: this.calculateCost(inputTokens, outputTokens)
      };

    } catch (error) {
      console.error("Error in OpenRouter API call:", error);
      throw error;
    }
  }

  getModel(): { id: string; info: ModelInfo } {
    return {
      id: this.model,
      info: {
        contextWindow: 128000, // This varies by model
        supportsComputerUse: true,
        inputPricePerToken: 0.000002, // Approximate, varies by model
        outputPricePerToken: 0.000002
      }
    };
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const { inputPricePerToken, outputPricePerToken } = this.getModel().info;
    return (
      (inputTokens * (inputPricePerToken || 0)) +
      (outputTokens * (outputPricePerToken || 0))
    );
  }
}
