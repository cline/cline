import { Tiktoken, encodingForModel as _encodingForModel } from "js-tiktoken"
import { MessageContent, MessagePart, TemplateType } from "./types"

interface Encoding {
	encode: Tiktoken["encode"]
	decode: Tiktoken["decode"]
}

function encodingForModel(_: string): Encoding {
	// TODO: Implement this
	return _encodingForModel("gpt-4")
}

function countImageTokens(content: MessagePart): number {
	if (content.type === "imageUrl") {
		return 85
	}
	throw new Error("Non-image content type")
}

export function countTokens(
	content: MessageContent,
	// defaults to llama2 because the tokenizer tends to produce more tokens
	modelName = "gpt-4o",
): number {
	const encoding = encodingForModel(modelName)
	if (Array.isArray(content)) {
		return content.reduce((acc, part) => {
			return acc + (part.type === "text" ? encoding.encode(part.text ?? "", "all", []).length : countImageTokens(part))
		}, 0)
	} else {
		return encoding.encode(content ?? "", "all", []).length
	}
}

export function pruneLinesFromTop(prompt: string, maxTokens: number, modelName: string): string {
	let totalTokens = countTokens(prompt, modelName)
	const lines = prompt.split("\n")
	while (totalTokens > maxTokens && lines.length > 0) {
		totalTokens -= countTokens(lines.shift()!, modelName)
	}

	return lines.join("\n")
}

export function pruneLinesFromBottom(prompt: string, maxTokens: number, modelName: string): string {
	let totalTokens = countTokens(prompt, modelName)
	const lines = prompt.split("\n")
	while (totalTokens > maxTokens && lines.length > 0) {
		totalTokens -= countTokens(lines.pop()!, modelName)
	}

	return lines.join("\n")
}
