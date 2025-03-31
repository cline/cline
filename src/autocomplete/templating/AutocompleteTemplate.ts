// Fill in the middle prompts

import { getLastNUriRelativePathParts, getShortestUniqueRelativeUriPaths } from "../../utils/uri.js"
import { CompletionOptions } from "../api/mistral.js"
import { AutocompleteCodeSnippet, AutocompleteSnippet, AutocompleteSnippetType } from "../snippets/types.js"

export interface AutocompleteTemplate {
	compilePrefixSuffix?: (
		prefix: string,
		suffix: string,
		filepath: string,
		reponame: string,
		snippets: AutocompleteSnippet[],
		workspaceUris: string[],
	) => [string, string]
	template:
		| string
		| ((
				prefix: string,
				suffix: string,
				filepath: string,
				reponame: string,
				language: string,
				snippets: AutocompleteSnippet[],
				workspaceUris: string[],
		  ) => string)
	completionOptions?: Partial<CompletionOptions>
}

// https://huggingface.co/stabilityai/stable-code-3b
const stableCodeFimTemplate: AutocompleteTemplate = {
	template: "<fim_prefix>{{{prefix}}}<fim_suffix>{{{suffix}}}<fim_middle>",
	completionOptions: {
		stop: ["<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<file_sep>", "<|endoftext|>", "</fim_middle>", "</code>"],
	},
}

// https://github.com/QwenLM/Qwen2.5-Coder?tab=readme-ov-file#3-file-level-code-completion-fill-in-the-middle
// This issue asks about the use of <|repo_name|> and <|file_sep|> together with <|fim_prefix|>, <|fim_suffix|> and <|fim_middle|>
// https://github.com/QwenLM/Qwen2.5-Coder/issues/343
const qwenCoderFimTemplate: AutocompleteTemplate = {
	template: "<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>",
	completionOptions: {
		stop: [
			"<|endoftext|>",
			"<|fim_prefix|>",
			"<|fim_middle|>",
			"<|fim_suffix|>",
			"<|fim_pad|>",
			"<|repo_name|>",
			"<|file_sep|>",
			"<|im_start|>",
			"<|im_end|>",
		],
	},
}

const codestralFimTemplate: AutocompleteTemplate = {
	template: "[SUFFIX]{{{suffix}}}[PREFIX]{{{prefix}}}",
	completionOptions: {
		stop: ["[PREFIX]", "[SUFFIX]"],
	},
}

const codestralMultifileFimTemplate: AutocompleteTemplate = {
	compilePrefixSuffix: (prefix, suffix, filepath, reponame, snippets, workspaceUris): [string, string] => {
		function getFileName(snippet: { uri: string; uniquePath: string }) {
			return snippet.uri.startsWith("file://") ? snippet.uniquePath : snippet.uri
		}

		if (snippets.length === 0) {
			if (suffix.trim().length === 0 && prefix.trim().length === 0) {
				return [`+++++ ${getLastNUriRelativePathParts(workspaceUris, filepath, 2)}\n${prefix}`, suffix]
			}
			return [prefix, suffix]
		}

		const relativePaths = getShortestUniqueRelativeUriPaths(
			[...snippets.map((snippet) => ("filepath" in snippet ? snippet.filepath : "file:///Untitled.txt")), filepath],
			workspaceUris,
		)

		const otherFiles = snippets
			.map((snippet, i) => {
				if (snippet.type === AutocompleteSnippetType.Diff) {
					return snippet.content
				}

				return `+++++ ${getFileName(relativePaths[i])} \n${snippet.content}`
			})
			.join("\n\n")

		return [`${otherFiles}\n\n+++++ ${getFileName(relativePaths[relativePaths.length - 1])}\n${prefix}`, suffix]
	},
	template: (prefix: string, suffix: string): string => {
		return `[SUFFIX]${suffix}[PREFIX]${prefix}`
	},
	completionOptions: {
		stop: ["[PREFIX]", "[SUFFIX]", "\n+++++ "],
	},
}

const codegemmaFimTemplate: AutocompleteTemplate = {
	template: "<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>",
	completionOptions: {
		stop: ["<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", "<|file_separator|>", "<end_of_turn>", "<eos>"],
	},
}

// https://arxiv.org/pdf/2402.19173.pdf section 5.1
const starcoder2FimTemplate: AutocompleteTemplate = {
	template: (prefix, suffix, filename, reponame, language, snippets, workspaceUris): string => {
		const otherFiles =
			snippets.length === 0
				? ""
				: `<file_sep>${snippets
						.map((snippet) => {
							return snippet.content
						})
						.join("<file_sep>")}<file_sep>`

		const prompt = `${otherFiles}<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`
		return prompt
	},
	completionOptions: {
		stop: ["<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<file_sep>", "<|endoftext|>"],
	},
}

const codeLlamaFimTemplate: AutocompleteTemplate = {
	template: "<PRE> {{{prefix}}} <SUF>{{{suffix}}} <MID>",
	completionOptions: { stop: ["<PRE>", "<SUF>", "<MID>", "<EOT>"] },
}

// https://huggingface.co/deepseek-ai/deepseek-coder-1.3b-base
const deepseekFimTemplate: AutocompleteTemplate = {
	template: "<｜fim▁begin｜>{{{prefix}}}<｜fim▁hole｜>{{{suffix}}}<｜fim▁end｜>",
	completionOptions: {
		stop: ["<｜fim▁begin｜>", "<｜fim▁hole｜>", "<｜fim▁end｜>", "//", "<｜end▁of▁sentence｜>"],
	},
}

// https://github.com/THUDM/CodeGeeX4/blob/main/guides/Infilling_guideline.md
const codegeexFimTemplate: AutocompleteTemplate = {
	template: (prefix, suffix, filepath, reponame, language, allSnippets, workspaceUris): string => {
		const snippets = allSnippets.filter(
			(snippet) => snippet.type === AutocompleteSnippetType.Code,
		) as AutocompleteCodeSnippet[]

		const relativePaths = getShortestUniqueRelativeUriPaths(
			[...snippets.map((snippet) => snippet.filepath), filepath],
			workspaceUris,
		)
		const baseTemplate = `###PATH:${
			relativePaths[relativePaths.length - 1]
		}\n###LANGUAGE:${language}\n###MODE:BLOCK\n<|code_suffix|>${suffix}<|code_prefix|>${prefix}<|code_middle|>`
		if (snippets.length === 0) {
			return `<|user|>\n${baseTemplate}<|assistant|>\n`
		}
		const references = `###REFERENCE:\n${snippets
			.map((snippet, i) => `###PATH:${relativePaths[i]}\n${snippet.content}\n`)
			.join("###REFERENCE:\n")}`
		const prompt = `<|user|>\n${references}\n${baseTemplate}<|assistant|>\n`
		return prompt
	},
	completionOptions: {
		stop: ["<|user|>", "<|code_suffix|>", "<|code_prefix|>", "<|code_middle|>", "<|assistant|>", "<|endoftext|>"],
	},
}

const gptAutocompleteTemplate: AutocompleteTemplate = {
	template: `\`\`\`
{{{prefix}}}[BLANK]{{{suffix}}}
\`\`\`

Fill in the blank to complete the code block. Your response should include only the code to replace [BLANK], without surrounding backticks.`,
	completionOptions: { stop: ["\n"] },
}

const holeFillerTemplate: AutocompleteTemplate = {
	template: (prefix: string, suffix: string) => {
		// From https://github.com/VictorTaelin/AI-scripts
		const SYSTEM_MSG = `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{HOLE_NAME}}'. Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed.  All completions MUST be truthful, accurate, well-written and correct.

## EXAMPLE QUERY:

<QUERY>
function sum_evens(lim) {
  var sum = 0;
  for (var i = 0; i < lim; ++i) {
    {{FILL_HERE}}
  }
  return sum;
}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole.

## CORRECT COMPLETION

<COMPLETION>if (i % 2 === 0) {
      sum += i;
    }</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
def sum_list(lst):
  total = 0
  for x in lst:
  {{FILL_HERE}}
  return total

print sum_list([1, 2, 3])
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>  total += x</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
// data Tree a = Node (Tree a) (Tree a) | Leaf a

// sum :: Tree Int -> Int
// sum (Node lft rgt) = sum lft + sum rgt
// sum (Leaf val)     = val

// convert to TypeScript:
{{FILL_HERE}}
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>type Tree<T>
  = {$:"Node", lft: Tree<T>, rgt: Tree<T>}
  | {$:"Leaf", val: T};

function sum(tree: Tree<number>): number {
  switch (tree.$) {
    case "Node":
      return sum(tree.lft) + sum(tree.rgt);
    case "Leaf":
      return tree.val;
  }
}</COMPLETION>

## EXAMPLE QUERY:

The 5th {{FILL_HERE}} is Jupiter.

## CORRECT COMPLETION:

<COMPLETION>planet from the Sun</COMPLETION>

## EXAMPLE QUERY:

function hypothenuse(a, b) {
  return Math.sqrt({{FILL_HERE}}b ** 2);
}

## CORRECT COMPLETION:

<COMPLETION>a ** 2 + </COMPLETION>`

		const fullPrompt =
			SYSTEM_MSG +
			`\n\n<QUERY>\n${prefix}{{FILL_HERE}}${suffix}\n</QUERY>\nTASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.\n<COMPLETION>`
		return fullPrompt
	},
	completionOptions: {
		stop: ["</COMPLETION>"],
	},
}

export function getTemplateForModel(model: string): AutocompleteTemplate {
	const lowerCaseModel = model.toLowerCase()

	// if (lowerCaseModel.includes("starcoder2")) {
	//   return starcoder2FimTemplate;
	// }

	if (lowerCaseModel.includes("qwen") && lowerCaseModel.includes("coder")) {
		return qwenCoderFimTemplate
	}

	if (
		lowerCaseModel.includes("starcoder") ||
		lowerCaseModel.includes("star-coder") ||
		lowerCaseModel.includes("starchat") ||
		lowerCaseModel.includes("octocoder") ||
		lowerCaseModel.includes("stable") ||
		lowerCaseModel.includes("codeqwen") ||
		lowerCaseModel.includes("qwen")
	) {
		return stableCodeFimTemplate
	}

	if (lowerCaseModel.includes("codestral")) {
		return codestralMultifileFimTemplate
	}

	if (lowerCaseModel.includes("codegemma")) {
		return codegemmaFimTemplate
	}

	if (lowerCaseModel.includes("codellama")) {
		return codeLlamaFimTemplate
	}

	if (lowerCaseModel.includes("deepseek")) {
		return deepseekFimTemplate
	}

	if (lowerCaseModel.includes("codegeex")) {
		return codegeexFimTemplate
	}

	if (
		lowerCaseModel.includes("gpt") ||
		lowerCaseModel.includes("davinci-002") ||
		lowerCaseModel.includes("claude") ||
		lowerCaseModel.includes("granite3") ||
		lowerCaseModel.includes("granite-3")
	) {
		return holeFillerTemplate
	}

	return stableCodeFimTemplate
}
