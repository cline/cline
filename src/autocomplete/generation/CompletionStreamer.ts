import Mistral, { CompletionOptions } from "../api/mistral"
import { StreamTransformPipeline } from "../filtering/streamTransforms/StreamTransformPipeline"
import { HelperVars } from "../util/HelperVars"

import { GeneratorReuseManager } from "./GeneratorReuseManager"

export class CompletionStreamer {
	private streamTransformPipeline = new StreamTransformPipeline()
	private generatorReuseManager: GeneratorReuseManager

	constructor(onError: (err: any) => void) {
		this.generatorReuseManager = new GeneratorReuseManager(onError)
	}

	async *streamCompletionWithFilters(
		token: AbortSignal,
		llm: Mistral,
		prefix: string,
		suffix: string,
		prompt: string,
		multiline: boolean,
		completionOptions: Partial<CompletionOptions> | undefined,
		helper: HelperVars,
	) {
		// Try to reuse pending requests if what the user typed matches start of completion
		const generator = this.generatorReuseManager.getGenerator(
			prefix,
			(abortSignal: AbortSignal) => llm.streamFim(prefix, suffix, abortSignal, completionOptions),
			multiline,
		)

		// Full stop means to stop the LLM's generation, instead of just truncating the displayed completion
		const fullStop = () => this.generatorReuseManager.currentGenerator?.cancel()

		// LLM
		const generatorWithCancellation = async function* () {
			for await (const update of generator) {
				if (token.aborted) {
					console.log("abort")
					return
				}
				yield update
			}
		}

		const initialGenerator = generatorWithCancellation()
		const transformedGenerator = helper.options.transform
			? this.streamTransformPipeline.transform(
					initialGenerator,
					prefix,
					suffix,
					multiline,
					completionOptions?.stop || [],
					fullStop,
					helper,
				)
			: initialGenerator

		for await (const update of transformedGenerator) {
			yield update
		}
	}
}
