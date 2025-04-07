import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, premModels, premDefaultModelId, PremModelId } from "../../shared/api"
import { ApiStream } from "../transform/stream"

// Update ApiHandlerOptions in shared/api.ts to include these
declare module "../../shared/api" {
  interface ApiHandlerOptions {
    premApiKey?: string
    premBaseUrl?: string
    premProjectId?: number
    premModelId?: string
  }
}

interface PremChatCompletionInput {
  project_id: number
  session_id?: string
  repositories?: {
    ids?: number[]
    limit?: number
    similarity_threshold?: number
  }
  messages: {
    role: "user" | "assistant" | "system"
    content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>
  }[]
  model: string
  system_prompt?: string
  max_tokens?: number
  stream?: boolean
  temperature?: number
  tools?: {
    type: "function"
    function: {
      name: string
      parameters: {
        type: string
        properties: Record<string, { type: string; description: string }>
        required: string[]
      }
    }
  }[]
}

interface PremEmbeddingsInput {
  project_id: number
  model: string
  encoding_format?: "float" | "base64"
  input: string | string[] | number[] | number[][]
}

interface PremRepositoryInput {
  name: string
  organization: string
  description?: string
}

interface PremRepositoryDocumentInput {
  repository_id: number
  file: string
}

export const premModelInfo: ModelInfo = {
  maxTokens: 8192,
  contextWindow: 32768,
  supportsImages: true,
  supportsComputerUse: false,
  supportsPromptCache: true,
  inputPrice: 0.0015,
  outputPrice: 0.002,
  description: "Prem AI model"
}

export class PremHandler implements ApiHandler {
  private options: ApiHandlerOptions
  private baseUrl: string
  private projectId: number
  private modelId: PremModelId

  constructor(options: ApiHandlerOptions) {
    this.options = options
    this.baseUrl = options.premBaseUrl || "https://app.premai.io"
    this.projectId = Number(options.premProjectId) || 1
    this.modelId = (options.premModelId as PremModelId) || premDefaultModelId
  }

  private async fetchWithAuth(endpoint: string, options: RequestInit) {
    const headers = new Headers(options.headers)
    headers.set("Authorization", `Bearer ${this.options.premApiKey}`)
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || "Unknown error occurred")
    }

    return response
  }

  async *createMessage(systemPrompt: string, messages: Array<{ role: string; content: string }>): ApiStream {
    const payload: PremChatCompletionInput = {
      project_id: this.projectId,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
      ],
      model: this.modelId,
      stream: true,
      temperature: 0.7,
    }

    const response = await this.fetchWithAuth("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split("\n").filter(line => line.trim())

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(5))
            if (data.choices?.[0]?.message?.content) {
              yield {
                type: "text",
                text: data.choices[0].message.content,
              }
            }
          }
        }
      }
    }
  }

  async createEmbeddings(input: string | string[]): Promise<number[][]> {
    const payload: PremEmbeddingsInput = {
      project_id: this.projectId,
      model: this.modelId,
      input: input,
    }

    const response = await this.fetchWithAuth("/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json()
    return result.data.map((item: { embedding: number[] }) => item.embedding)
  }

  async createRepository(input: PremRepositoryInput) {
    const response = await this.fetchWithAuth("/api/repositories/repositories/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })

    return response.json()
  }

  async uploadDocument(input: PremRepositoryDocumentInput) {
    const formData = new FormData()
    formData.append("file", await fetch(input.file).then(r => r.blob()))

    const response = await this.fetchWithAuth(`/api/repositories/repository/${input.repository_id}/document`, {
      method: "POST",
      body: formData,
    })

    return response.json()
  }

  getModel(): { id: string; info: ModelInfo } {
    return {
      id: this.modelId,
      info: premModels[this.modelId],
    }
  }
} 