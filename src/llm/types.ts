export type TextMessagePart = {
	type: "text"
	text: string
}

export type ImageMessagePart = {
	type: "imageUrl"
	imageUrl: { url: string }
}

export type MessagePart = TextMessagePart | ImageMessagePart

export type MessageContent = string | MessagePart[]

export type TemplateType =
	| "llama2"
	| "alpaca"
	| "zephyr"
	| "phi2"
	| "phind"
	| "anthropic"
	| "chatml"
	| "none"
	| "openchat"
	| "deepseek"
	| "xwin-coder"
	| "neural-chat"
	| "codellama-70b"
	| "llava"
	| "gemma"
	| "granite"
	| "llama3"
