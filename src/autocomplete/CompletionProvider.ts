import { shouldCompleteMultiline } from "./classification/shouldCompleteMultiline.js"
import { ContextRetrievalService } from "./context/ContextRetrievalService.js"

import { BracketMatchingService } from "./filtering/BracketMatchingService.js"
import { CompletionStreamer } from "./generation/CompletionStreamer.js"
import { postprocessCompletion } from "./postprocessing/index.js"
import { shouldPrefilter } from "./prefiltering/index.js"
import { RecentlyEditedTracker } from "./recentlyEdited.js"
import { RecentlyVisitedRangesService } from "./RecentlyVisitedRangesService.js"
import { getAllSnippets } from "./snippets/index.js"
import { renderPrompt } from "./templating/index.js"
import { TabAutocompleteOptions } from "./types.js"
import { AutocompleteDebouncer } from "./util/AutocompleteDebouncer.js"
// import { AutocompleteLoggingService } from "./util/AutocompleteLoggingService.js"
// import AutocompleteLruCache from "./util/AutocompleteLruCache.js"
import { HelperVars } from "./util/HelperVars.js"
import { AutocompleteInput, AutocompleteOutcome } from "./util/types.js"
import * as vscode from "vscode"
import { v4 as uuidv4 } from "uuid"
import { getRepoName, getUniqueId, getWorkspaceDirs } from "../utils/vscode.js"
import * as URI from "uri-js"
import { processSingleLineCompletion } from "./util/processSingleLineCompletion.js"
import { AutocompleteLoggingService } from "./util/AutocompleteLoggingService.js"
import Mistral from "./api/mistral.js"

// const autocompleteCache = AutocompleteLruCache.get()

// Errors that can be expected on occasion even during normal functioning should not be shown.
// Not worth disrupting the user to tell them that a single autocomplete request didn't go through
const ERRORS_TO_IGNORE = [
	// From Ollama
	"unexpected server status",
	"operation was aborted",
]

export const AUTOCOMPLETE_PROVIDER = "mistral"
export const AUTOCOMPLETE_MODEL = "codestral-latest"

export const DEFAULT_AUTOCOMPLETE_OPTS: TabAutocompleteOptions = {
	disable: false,
	maxPromptTokens: 1024,
	prefixPercentage: 0.3,
	maxSuffixPercentage: 0.2,
	debounceDelay: 350,
	multilineCompletions: "auto",
	useCache: true,
	onlyMyCode: true,
	useRecentlyEdited: true,
	disableInFiles: undefined,
	useImports: true,
	transform: false,
	showWhateverWeHaveAtXMs: 300,
	experimental_includeClipboard: true,
	experimental_includeRecentlyVisitedRanges: true,
	experimental_includeRecentlyEditedRanges: true,
	experimental_includeDiff: true,
	slidingWindowPrefixPercentage: 0.75,
	slidingWindowSize: 500,
}

export class CompletionProvider implements vscode.InlineCompletionItemProvider {
	private context: vscode.ExtensionContext
	// private autocompleteCache = AutocompleteLruCache.get()
	public errorsShown: Set<string> = new Set()
	private bracketMatchingService = new BracketMatchingService()
	private debouncer = new AutocompleteDebouncer()
	private completionStreamer: CompletionStreamer
	private loggingService = new AutocompleteLoggingService()
	private contextRetrievalService: ContextRetrievalService
	private recentlyVisitedRanges: RecentlyVisitedRangesService
	private recentlyEditedTracker = new RecentlyEditedTracker()

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.completionStreamer = new CompletionStreamer(this.onError.bind(this))
		this.contextRetrievalService = new ContextRetrievalService()
		this.recentlyVisitedRanges = new RecentlyVisitedRangesService()
	}
	_lastShownCompletion: AutocompleteOutcome | undefined

	private onError(e: any) {
		if (ERRORS_TO_IGNORE.some((err) => (typeof e === "string" ? e.includes(err) : e?.message?.includes(err)))) {
			return
		}

		console.warn("Error generating autocompletion: ", e)
		if (!this.errorsShown.has(e.message)) {
			this.errorsShown.add(e.message)
			let message = e.message
			vscode.window.showErrorMessage(message)
		}
	}

	public cancel() {
		this.loggingService.cancel()
	}

	public accept(completionId: string) {
		const outcome = this.loggingService.accept(completionId)
		if (!outcome) {
			return
		}
		this.bracketMatchingService.handleAcceptedCompletion(outcome.completion, outcome.filepath)
	}

	public markDisplayed(completionId: string, outcome: AutocompleteOutcome) {
		this.loggingService.markDisplayed(completionId, outcome)
	}

	private async _getAutocompleteOptions() {
		return DEFAULT_AUTOCOMPLETE_OPTS
	}

	private async _provideInlineCompletionItems(
		input: AutocompleteInput,
		token: AbortSignal | undefined,
	): Promise<AutocompleteOutcome | undefined> {
		try {
			// Create abort signal if not given
			if (!token) {
				const controller = this.loggingService.createAbortController(input.completionId)
				token = controller.signal
			}
			const startTime = Date.now()
			const options = await this._getAutocompleteOptions()

			// Debounce
			if (await this.debouncer.delayAndShouldDebounce(options.debounceDelay)) {
				return undefined
			}

			const llm = new Mistral({
				model: AUTOCOMPLETE_MODEL,
			})
			llm.apiKey = "TBD"

			const helper = await HelperVars.create(input, options, AUTOCOMPLETE_MODEL)

			if (await shouldPrefilter(helper)) {
				return undefined
			}

			const [snippetPayload, workspaceDirs] = await Promise.all([
				getAllSnippets(this.context, {
					helper,
					contextRetrievalService: this.contextRetrievalService,
				}),
				getWorkspaceDirs(),
			])
			console.log("start2")

			const { prompt, prefix, suffix, completionOptions } = renderPrompt({
				snippetPayload,
				workspaceDirs,
				helper,
			})

			// Completion
			let completion: string | undefined = ""

			// const cache = await autocompleteCache
			// const cachedCompletion = helper.options.useCache ? await cache.get(helper.prunedPrefix) : undefined
			// let cacheHit = false
			// if (cachedCompletion) {
			// 	// Cache
			// 	cacheHit = true
			// 	completion = cachedCompletion
			// } else {
			const multiline = !helper.options.transform || shouldCompleteMultiline(helper)

			const completionStream = this.completionStreamer.streamCompletionWithFilters(
				token,
				llm,
				prefix,
				suffix,
				prompt,
				multiline,
				completionOptions,
				helper,
			)

			for await (const update of completionStream) {
				completion += update
			}

			console.log("completion", completion)

			// Don't postprocess if aborted
			// if (token.aborted) {
			// 	console.log("aborting")
			// 	return undefined
			// }

			const processedCompletion = helper.options.transform
				? postprocessCompletion({
						completion,
						prefix: helper.prunedPrefix,
						suffix: helper.prunedSuffix,
						model: AUTOCOMPLETE_MODEL,
					})
				: completion

			completion = processedCompletion
			console.log("processed", processedCompletion)

			if (!completion) {
				return undefined
			}

			const outcome: AutocompleteOutcome = {
				time: Date.now() - startTime,
				completion,
				prefix,
				suffix,
				prompt,
				modelProvider: AUTOCOMPLETE_PROVIDER,
				modelName: AUTOCOMPLETE_MODEL,
				completionOptions,
				cacheHit: false,
				filepath: helper.filepath,
				numLines: completion.split("\n").length,
				completionId: helper.input.completionId,
				gitRepo: await getRepoName(helper.filepath),
				uniqueId: await getUniqueId(),
				timestamp: Date.now(),
				...helper.options,
			}

			console.log("OUTCOME", outcome)

			//////////

			// // TODO Save to cache
			// if (!outcome.cacheHit && helper.options.useCache) {
			// 	;(await this.autocompleteCache).put(outcome.prefix, outcome.completion)
			// }

			return outcome
		} catch (e: any) {
			this.onError(e)
		} finally {
			console.log("butwhy2")
			this.loggingService.deleteAbortController(input.completionId)
		}
	}

	public async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
		//@ts-ignore
	): ProviderResult<InlineCompletionItem[] | InlineCompletionList> {
		console.log("start")
		// TODO: Add status bar to disable autocomplete
		// const enableTabAutocomplete = getStatusBarStatus() === StatusBarStatus.Enabled
		if (token.isCancellationRequested) {
			return null
		}

		if (document.uri.scheme === "vscode-scm") {
			return null
		}

		// Don't autocomplete with multi-cursor
		const editor = vscode.window.activeTextEditor
		if (editor && editor.selections.length > 1) {
			return null
		}

		const selectedCompletionInfo = context.selectedCompletionInfo

		// This code checks if there is a selected completion suggestion in the given context and ensures that it is valid
		// To improve the accuracy of suggestions it checks if the user has typed at least 4 characters
		// This helps refine and filter out irrelevant autocomplete options
		if (selectedCompletionInfo) {
			const { text, range } = selectedCompletionInfo
			const typedText = document.getText(range)

			const typedLength = range.end.character - range.start.character

			if (typedLength < 4) {
				return null
			}

			if (!text.startsWith(typedText)) {
				return null
			}
		}
		let injectDetails: string | undefined = undefined

		try {
			const abortController = new AbortController()
			const signal = abortController.signal
			token.onCancellationRequested(() => {
				console.log("cancellation requested")
				abortController.abort()
			})

			// Handle notebook cells
			const pos = {
				line: position.line,
				character: position.character,
			}
			let manuallyPassFileContents: string | undefined = undefined
			if (document.uri.scheme === "vscode-notebook-cell") {
				const notebook = vscode.workspace.notebookDocuments.find((notebook) =>
					notebook.getCells().some((cell) => URI.equal(cell.document.uri.toString(), document.uri.toString())),
				)
				if (notebook) {
					const cells = notebook.getCells()
					manuallyPassFileContents = cells
						.map((cell) => {
							const text = cell.document.getText()
							if (cell.kind === vscode.NotebookCellKind.Markup) {
								return `"""${text}"""`
							} else {
								return text
							}
						})
						.join("\n\n")
					for (const cell of cells) {
						if (URI.equal(cell.document.uri.toString(), document.uri.toString())) {
							break
						} else {
							pos.line += cell.document.getText().split("\n").length + 1
						}
					}
				}
			}

			// Manually pass file contents for unsaved, untitled files
			if (document.isUntitled) {
				manuallyPassFileContents = document.getText()
			}

			// Handle commit message input box
			let manuallyPassPrefix: string | undefined = undefined

			const input: AutocompleteInput = {
				pos,
				manuallyPassFileContents,
				manuallyPassPrefix,
				selectedCompletionInfo,
				injectDetails,
				isUntitledFile: document.isUntitled,
				completionId: uuidv4(),
				filepath: document.uri.toString(),
				recentlyVisitedRanges: this.recentlyVisitedRanges.getSnippets(),
				recentlyEditedRanges: await this.recentlyEditedTracker.getRecentlyEditedRanges(),
			}

			// TODO: Add status bar status
			// setupStatusBar(undefined, true)
			const outcome = await this._provideInlineCompletionItems(input, signal)

			console.log(!outcome)
			console.log(outcome && !outcome.completion)
			console.log(outcome)
			if (!outcome || !outcome.completion) {
				return null
			}

			// VS Code displays dependent on selectedCompletionInfo (their docstring below)
			// We should first always make sure we have a valid completion, but if it goes wrong we
			// want telemetry to be correct
			/**
			 * Provides information about the currently selected item in the autocomplete widget if it is visible.
			 *
			 * If set, provided inline completions must extend the text of the selected item
			 * and use the same range, otherwise they are not shown as preview.
			 * As an example, if the document text is `console.` and the selected item is `.log` replacing the `.` in the document,
			 * the inline completion must also replace `.` and start with `.log`, for example `.log()`.
			 *
			 * Inline completion providers are requested again whenever the selected item changes.
			 */
			if (selectedCompletionInfo) {
				outcome.completion = selectedCompletionInfo.text + outcome.completion
			}
			// const willDisplay = this.willDisplay(document, selectedCompletionInfo, signal, outcome)
			// console.log("willdisplay", willDisplay)
			// if (!willDisplay) {
			// return null
			// }

			// Mark displayed
			this.markDisplayed(input.completionId, outcome)
			this._lastShownCompletion = outcome

			// Construct the range/text to show
			const startPos = selectedCompletionInfo?.range.start ?? position
			let range = new vscode.Range(startPos, startPos)
			let completionText = outcome.completion
			const isSingleLineCompletion = outcome.completion.split("\n").length <= 1

			if (isSingleLineCompletion) {
				const lastLineOfCompletionText = completionText.split("\n").pop() || ""
				const currentText = document.lineAt(startPos).text.substring(startPos.character)

				const result = processSingleLineCompletion(lastLineOfCompletionText, currentText, startPos.character)

				console.log(result)
				if (result === undefined) {
					return undefined
				}

				completionText = result.completionText
				if (result.range) {
					range = new vscode.Range(
						new vscode.Position(startPos.line, result.range.start),
						new vscode.Position(startPos.line, result.range.end),
					)
				}
			} else {
				// Extend the range to the end of the line for multiline completions
				range = new vscode.Range(startPos, document.lineAt(startPos).range.end)
			}

			console.log("completiontext", completionText)

			const completionItem = new vscode.InlineCompletionItem(
				completionText,
				range,
				// 	{
				// 	title: "Log Autocomplete Outcome",
				// 	command: "continue.logAutocompleteOutcome",
				// 	arguments: [input.completionId, this.completionProvider],
				// }
			)

			;(completionItem as any).completeBracketPairs = true
			return [completionItem]
		} finally {
			// stopStatusBarLoading()
		}
	}

	willDisplay(
		document: vscode.TextDocument,
		selectedCompletionInfo: vscode.SelectedCompletionInfo | undefined,
		abortSignal: AbortSignal,
		outcome: AutocompleteOutcome,
	): boolean {
		if (selectedCompletionInfo) {
			const { text, range } = selectedCompletionInfo
			if (!outcome.completion.startsWith(text)) {
				console.log(`Won't display completion because text doesn't match: ${text}, ${outcome.completion}`, range)
				return false
			}
		}

		if (abortSignal.aborted) {
			return false
		}

		return true
	}
}
