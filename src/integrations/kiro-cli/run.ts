import { RuntimeShimWrapper } from "@/core/api/runtime/shim-wrapper"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { buildKiroCliPrompt } from "./prompt"

type KiroCliOptions = {
	systemPrompt: string
	messages: ClineStorageMessage[]
	path?: string
	cwd?: string
	env?: NodeJS.ProcessEnv
	timeoutMs?: number
}

const lineTranslator = {
	translateStdout(line: string) {
		return [line]
	},
	flush() {
		return [] as string[]
	},
}

export async function* runKiroCli(options: KiroCliOptions): AsyncGenerator<string> {
	const shim = new RuntimeShimWrapper()
	const prompt = buildKiroCliPrompt(options.systemPrompt, options.messages)
	let emittedFirstLine = false

	for await (const line of shim.execute(
		{
			command: options.path?.trim() || "kiro-cli",
			args: ["chat", "--no-interactive", "--trust-all-tools", prompt],
			cwd: options.cwd ?? process.cwd(),
			env: options.env,
			timeoutMs: options.timeoutMs,
		},
		lineTranslator,
	)) {
		yield emittedFirstLine ? `\n${line}` : line
		emittedFirstLine = true
	}
}
