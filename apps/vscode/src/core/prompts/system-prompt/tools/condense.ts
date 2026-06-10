import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.CONDENSE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "condense",
	description: `Request to create a detailed summary of the conversation so far, which will be used to compact the current context window while retaining key information. With this tool you will summarise the conversation paying close attention to the user's explicit requests and your previous actions. The user will be presented with a preview of your generated summary and can choose to use it to compact their context window or keep chatting in the current conversation.`,
	parameters: [
		{
			name: "context",
			required: true,
			instruction: `The context to continue the conversation with. Should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation.
  2. Current Work: Describe in detail what was being worked on prior to this compaction request.
  3. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
  4. Relevant Files and Code: Enumerate specific files and code sections examined, modified, or created.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks and next steps, including direct quotes where helpful.`,
			usage: "your detailed conversation summary",
		},
	],
}

export const condense_variants = [generic]
