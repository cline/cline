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

	/** Cline ➜ miibo フォーマット変換 */
	private async buildMiiboPayload(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]) {
		// ❶ 最後の user メッセージだけを拾う
		const lastUser = [...messages].reverse().find((m) => m.role === "user") ?? null // ← null フォールバック

		const now = new Date()
		// const sessionUid = `cline-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
		const sessionUid = `cline-miibo`
		// miibo のチャット API パラメータ
		const payload: Record<string, any> = {
			api_key: this.options.miiboApiKey,
			agent_id: this.options.miiboApiModelId,
			uid: sessionUid,
			stream: false,
			// ❷ systemPrompt を start_utterance に渡す
			start_utterance: `${systemPrompt ?? ""}`,
			utterance: "",
			history_id: "",
		}

		/* ---- 以下は lastUser が存在する場合だけ処理 ---- */
		if (lastUser) {
			if (Array.isArray(lastUser.content)) {
				// 配列要素ごとに処理を統一
				for (const part of lastUser.content) {
					if (typeof part === "string") {
						payload.utterance += part
						continue
					}
					const p = part as any
					switch (p.type) {
						case "text":
							payload.utterance += p.text
							// console.log("[Miibo] utterance:", payload.utterance);
							break
						case "image_url": {
							const imageUrl = p.image_url.url
							// console.log("[Miibo] imageUrl:", imageUrl);
							try {
								const imageRes = await fetch(imageUrl)
								const arrayBuffer = await imageRes.arrayBuffer()
								payload.base64_image = Buffer.from(arrayBuffer).toString("base64")
								// console.log("[Miibo] base64_image:", payload.base64_image.slice(0, 100));
							} catch (e) {
								console.error("[Miibo] image fetch/encode error:", e)
							}
							break
						}
						case "image":
							payload.base64_image = p.source.data
							// console.log("[Miibo] base64_image from block param (length):", payload.base64_image.length);
							break
						default:
							// その他のオブジェクトは JSON に変換
							payload.utterance += JSON.stringify(p)
					}
				}
			} else {
				payload.utterance =
					typeof lastUser.content === "string" ? lastUser.content : JSON.stringify(lastUser.content ?? "")
			}
		} else {
			// user メッセージが 1 つも無いケース
			payload.utterance = ""
		}

		return payload
	}

	async *createMessage(
		_ignored: string, // ← 呼び出し側から渡された systemPrompt は無視
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
		/* --------------------------------------------------------------------
		 * Miibo 用プロンプトを **ここで直接生成** して注入
		 *   - cwd / supportsBrowserUse など動的値は不要なので空文字 & false
		 *   - isMiiboModelFamily=true で短縮版が返ってくる
		 * ------------------------------------------------------------------ */
		const miiboSystemPrompt = await SYSTEM_PROMPT_MIIBO(
			"", // cwd 未使用
			false, // supportsBrowserUse
			{} as any, // mcpHub 未使用
			{} as any, // browserSettings 未使用
			false, // isClaude4ModelFamily
			true, // isMiiboModelFamily
		)

		// ログ用
		// console.log("miibo systemPrompt (generated):", miiboSystemPrompt)

		const payload = await this.buildMiiboPayload(miiboSystemPrompt, messages)
		const url = this.options.miiboBaseUrl || "https://api-mebo.dev/api"
		// console.log("[Miibo] request URL:", url)
		// console.log("[Miibo] request payload:", payload)

		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			})

			// console.log("[Miibo] response status:", res.status)
			// console.log("[Miibo] response headers content-type:", res.headers.get("content-type"))

			if (!res.ok) {
				const errorText = await res.text()
				// console.error("[Miibo] HTTP error response:", errorText)
				throw new Error(`Miibo API returned ${res.status}: ${errorText}`)
			}

			const contentType = res.headers.get("content-type") || ""
			// console.log("[Miibo] content-type:", contentType)

			if (contentType.includes("text/event-stream")) {
				const body = res.body!
				// SSE 形式で返ってくる JSON を逐次パースし、bestResponse.utterance の差分をテキストチャンクとして yield
				for await (const chunk of this.handleSSE(body)) {
					yield chunk
				}
			} else {
				// JSON Lines形式のストリーミングレスポンスを処理
				const responseText = await res.text()
				// console.log("[Miibo] raw response text:", responseText)

				// 改行で分割してJSON Linesを処理
				const lines = responseText.trim().split("\n")
				let lastUtterance = ""

				for (const line of lines) {
					if (!line.trim()) {
						continue
					}

					try {
						const data = JSON.parse(line.trim())
						// console.log("[Miibo] parsed JSON line:", data)

						const currentUtterance = data.bestResponse?.utterance ?? data.utterance ?? ""
						if (currentUtterance.length > lastUtterance.length) {
							const delta = currentUtterance.slice(lastUtterance.length)
							lastUtterance = currentUtterance
							// console.log("[Miibo] delta text:", delta)
							yield { type: "text", text: delta }
						}
					} catch (jsonError) {
						// console.error("[Miibo] JSON parse failed for line:", line, jsonError)
					}
				}
			}
		} catch (error) {
			console.error("[Miibo] fetch error:", error)
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

	/**
	 * SSE で返ってくる JSON 行から bestResponse.utterance を差分で抽出し、テキストチャンクを生成する
	 */
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
			buffer = lines.pop()! // 不完全な行をバッファに残す
			for (let rawLine of lines) {
				// console.log("[Miibo SSE raw]:", rawLine)
				let line = rawLine.trim()
				if (!line) {
					continue
				}
				// SSE イベントの場合、'data:' プレフィックスを除去
				if (line.startsWith("data:")) {
					line = line.substring("data:".length).trim()
				}
				try {
					const obj = JSON.parse(line)
					// console.log("[Miibo SSE parsed]:", obj)
					const best = obj.bestResponse ?? obj
					const utterance = typeof best.utterance === "string" ? best.utterance : ""
					if (utterance.length > lastUtterance.length) {
						const delta = utterance.slice(lastUtterance.length)
						lastUtterance = utterance
						// console.log("[Miibo SSE delta]:", delta)
						yield { type: "text", text: delta }
					}
				} catch (e) {
					console.error("[Miibo SSE JSON parse error]:", e)
				}
			}
		}
	}
}

export default MiiboHandler
