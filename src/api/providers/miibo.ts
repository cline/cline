// src/api/providers/miibo.ts
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../index"
import { ApiHandlerOptions, ModelInfo } from "@shared/api"
import { ApiStream, ApiStreamChunk } from "../transform/stream"
import { SYSTEM_PROMPT as SYSTEM_PROMPT_MIIBO } from "@core/prompts/systemForMiibo"
import { Buffer } from "buffer"

export class MiiboHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	private async buildMiiboPayload(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]) {
		const lastUser = [...messages].reverse().find((m) => m.role === "user") ?? null

		const sessionUid = `cline-miibo`
		const payload: Record<string, any> = {
			api_key: this.options.miiboApiKey,
			agent_id: this.options.miiboApiModelId,
			uid: sessionUid,
			stream: false,
			start_utterance: `${systemPrompt ?? ""}`,
			utterance: "",
		}

		if (lastUser) {
			if (Array.isArray(lastUser.content)) {
				for (const part of lastUser.content) {
					if (typeof part === "string") {
						payload.utterance += part
						continue
					}
					const p = part as any
					switch (p.type) {
						case "text":
							payload.utterance += p.text
							break
						case "image_url": {
							const imageUrl = p.image_url.url
							const imageRes = await fetch(imageUrl)
							const arrayBuffer = await imageRes.arrayBuffer()
							payload.base64_image = Buffer.from(arrayBuffer).toString("base64")
							break
						}
						case "image":
							payload.base64_image = p.source.data
							break
						default:
							payload.utterance += JSON.stringify(p)
					}
				}
			} else {
				payload.utterance =
					typeof lastUser.content === "string" ? lastUser.content : JSON.stringify(lastUser.content ?? "")
			}
		} else {
			payload.utterance = ""
		}

		return payload
	}

	async *createMessage(_ignored: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const miiboSystemPrompt = await SYSTEM_PROMPT_MIIBO("", false, {} as any, {} as any, false, true)

		const payload = await this.buildMiiboPayload(miiboSystemPrompt, messages)
		const url = this.options.miiboBaseUrl || "https://api-mebo.dev/api"

		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			})

			if (!res.ok) {
				const errorText = await res.text()
				throw new Error(`Miibo API returned ${res.status}: ${errorText}`)
			}

			const contentType = res.headers.get("content-type") || ""

			if (contentType.includes("text/event-stream")) {
				const body = res.body!
				for await (const chunk of this.handleSSE(body)) {
					yield chunk
				}
			} else {
				const responseText = await res.text()

				const lines = responseText.trim().split("\n")
				let lastUtterance = ""

				for (const line of lines) {
					if (!line.trim()) {
						continue
					}
					const data = JSON.parse(line.trim())
					const currentUtterance = data.bestResponse?.utterance ?? data.utterance ?? ""
					if (currentUtterance.length > lastUtterance.length) {
						const delta = currentUtterance.slice(lastUtterance.length)
						lastUtterance = currentUtterance
						yield { type: "text", text: delta }
					}
				}
			}
		} catch (error) {
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.miiboApiModelId || "",
			info: {
				supportsPromptCache: false,
			},
		}
	}

	private async *handleSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<ApiStreamChunk> {
		const reader = body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""
		let lastUtterance = ""
		while (true) {
			const { done, value } = await reader.read()
			if (done) {
				break
			}
			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop()!
			for (let rawLine of lines) {
				let line = rawLine.trim()
				if (!line) {
					continue
				}
				if (line.startsWith("data:")) {
					line = line.substring("data:".length).trim()
				}
				try {
					const obj = JSON.parse(line)
					const best = obj.bestResponse ?? obj
					const utterance = typeof best.utterance === "string" ? best.utterance : ""
					if (utterance.length > lastUtterance.length) {
						const delta = utterance.slice(lastUtterance.length)
						lastUtterance = utterance
						yield { type: "text", text: delta }
					}
				} catch (e) {
					throw e
				}
			}
		}
	}
}

export default MiiboHandler
