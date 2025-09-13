import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.ASK,
	name: "ask_followup_question",
	description:
		"Ask the user a question to gather additional information needed to complete the task. This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. It allows for interactive problem-solving by enabling direct communication with the user. Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.",
	parameters: [
		{
			name: "question",
			required: true,
			instruction:
				"The question to ask the user. This should be a clear, specific question that addresses the information you need.",
			usage: "Your question here",
		},
		{
			name: "options",
			required: false,
			instruction:
				"An array of 2-5 options for the user to choose from. Each option should be a string describing a possible answer.",
			usage: 'Array of options here (optional), e.g. ["Option 1", "Option 2", "Option 3"]',
		},
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }
const gemini = { ...generic, variant: ModelFamily.GEMINI }

export const ask_followup_question_variants = [generic, nextGen, gpt, gemini]
