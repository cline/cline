import { dedent } from "../../utils/dedent"
import { ChatMessage } from "../types"

export type PromptTemplateFunction = (history: ChatMessage[], otherData: Record<string, string>) => string | ChatMessage[]

const codestralInsertionEditPrompt: PromptTemplateFunction = (_, otherData) => {
	return dedent`
    \`\`\`${otherData.language}
    ${otherData.prefix}[BLANK]${otherData.codeToEdit}${otherData.suffix}
    \`\`\`

    Above is the file of code that the user is currently editing in. Their cursor is located at the "[BLANK]". They have requested that you fill in the "[BLANK]" with code that satisfies the following request:

    "${otherData.userInput}"

    Please generate this code. Your output will be only the code that should replace the "[BLANK]", without repeating any of the prefix or suffix, without any natural language explanation, and without messing up indentation. Here is the code that will replace the "[BLANK]":`
}

const codestralFullFileEditPrompt: PromptTemplateFunction = (_, otherData) => {
	return dedent`
    \`\`\`${otherData.language}
    ${otherData.codeToEdit}
    \`\`\`

    Please rewrite the above file to address the following request:

    ${otherData.userInput}

    You should rewrite the entire file without any natural language explanation. DO NOT surround the code in a code block and DO NOT explain yourself.`
}

export const codestralEditPrompt: PromptTemplateFunction = (history, otherData) => {
	if (otherData?.codeToEdit?.trim().length === 0) {
		return codestralInsertionEditPrompt(history, otherData)
	} else if (otherData?.prefix?.trim().length === 0 && otherData?.suffix?.trim().length === 0) {
		return codestralFullFileEditPrompt(history, otherData)
	}

	const paragraphs = ["The user has requested a section of code in a file to be rewritten."]

	if (otherData.prefix?.trim().length > 0) {
		paragraphs.push(dedent`
        This is the prefix of the file:
        \`\`\`${otherData.language}
        ${otherData.prefix}
        \`\`\``)
	}

	if (otherData.suffix?.trim().length > 0) {
		paragraphs.push(dedent`
        This is the suffix of the file:
        \`\`\`${otherData.language}
        ${otherData.suffix}
        \`\`\``)
	}

	paragraphs.push(dedent`
        This is the "code to rewrite":
        \`\`\`${otherData.language}
        ${otherData.codeToEdit}
        \`\`\`

        The user's request is: "${otherData.userInput}"

        Here is the new version of "code to rewrite". Make sure not to rewrite any of the prefix or suffix:`)

	return paragraphs.join("\n\n")
}
