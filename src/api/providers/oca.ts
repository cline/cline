import OpenAI from "openai"
import { ApiHandlerOptions, liteLlmModelInfoSaneDefaults, type LiteLLMModelInfo } from "@shared/api"
import { LiteLlmHandler, type LiteLlmHandlerOptions } from "./litellm"
import { OcaTokenManager } from "@/core/controller/oca/util/ocaTokenManager"
import { Logger } from "@/services/logging/Logger"
import { DEFAULT_OCA_BASE_URL } from "@/core/controller/oca/util/constants"
import { createOcaHeaders } from "@/core/controller/oca/util/utils"

export class OcaHandler extends LiteLlmHandler {
	constructor(options: LiteLlmHandlerOptions) {
		super(options)
	}
	protected override initializeClient(options: LiteLlmHandlerOptions) {
		return new OpenAI({
			baseURL: options.liteLlmBaseUrl || DEFAULT_OCA_BASE_URL,
			apiKey: "noop",
			fetch: async (url, init) => {
				try {
					// Authorization Header
					const token = (await OcaTokenManager.getToken()).access_token
					if (!token) {
						throw new Error("Oracle Code Assist (OCA) access token is not available")
					}

					const globalFetch = (typeof fetch === "function" ? fetch : globalThis.fetch).bind(undefined)

					// OCA Headers
					const headersRecord = await createOcaHeaders(token, this.options.taskId!)
					const headers = new Headers()
					for (const [key, value] of Object.entries(headersRecord)) {
						headers.append(key, value)
					}
					Logger.log(`Making request with customer opc-request-id: ${headers.get("opc-request-id")}`)

					return await globalFetch(url, {
						...init,
						headers,
					})
				} catch (e) {
					console.error("Fetch failed:", e)
					throw e
				}
			},
		})
	}

	override ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.liteLlmApiKey) {
				throw new Error("Oracle Code Assist (OCA) access token is not available")
			}
			if (!this.options.liteLlmModelId) {
				throw new Error("Oracle Code Assist (OCA) model is not selected")
			}
			try {
				this.client = this.initializeClient(this.options)
			} catch (error) {
				throw new Error(`Error creating Oracle Code Assist (OCA) client: ${error.message}`)
			}
		}
		return this.client
	}
}
