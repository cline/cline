import { Anthropic } from "@anthropic-ai/sdk"
import * as path from "path"
import * as diff from "diff"

/**
 * Object containing functions to format various types of responses.
 */
export const formatResponse = {
	/**
	 * Generates a response for when a user denies an operation.
	 * @returns A string indicating the operation was denied.
	 */
	toolDenied: () => `The user denied this operation.`,

	/**
	 * Generates a response for when a user denies an operation and provides feedback.
	 * @param feedback - Optional feedback provided by the user.
	 * @returns A string containing the denial message and user feedback.
	 */
	toolDeniedWithFeedback: (feedback?: string) =>
		`The user denied this operation and provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`,

	/**
	 * Generates a response for when a tool execution fails.
	 * @param error - Optional error message from the failed execution.
	 * @returns A string containing the error message.
	 */
	toolError: (error?: string) => `The tool execution failed with the following error:\n<error>\n${error}\n</error>`,

	/**
	 * Generates a response for when no tools were used in the previous response.
	 * @returns A string with an error message and instructions for tool use.
	 */
	noToolsUsed: () =>
		`[ERROR] You did not use a tool in your previous response! Please retry with a tool use.

${toolUseInstructionsReminder}

# Next Steps

If you have completed the user's task, use the attempt_completion tool. 
If you require additional information from the user, use the ask_followup_question tool. 
Otherwise, if you have not completed the task and do not need additional information, then proceed with the next step of the task. 
(This is an automated message, so do not respond to it conversationally.)`,

	/**
	 * Generates a response for when there are too many mistakes.
	 * @param feedback - Optional feedback to guide the user.
	 * @returns A string with a message about the difficulties and user feedback.
	 */
	tooManyMistakes: (feedback?: string) =>
		`You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n<feedback>\n${feedback}\n</feedback>`,

	/**
	 * Generates an error message for a missing tool parameter.
	 * @param paramName - The name of the missing parameter.
	 * @returns A string with an error message and instructions for tool use.
	 */
	missingToolParameterError: (paramName: string) =>
		`Missing value for required parameter '${paramName}'. Please retry with complete response.\n\n${toolUseInstructionsReminder}`,

	/**
	 * Formats a tool result, potentially including images.
	 * @param text - The text result from the tool.
	 * @param images - Optional array of image data URLs.
	 * @returns A string or an array of text and image blocks.
	 */
	toolResult: (
		text: string,
		images?: string[]
	): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> => {
		if (images && images.length > 0) {
			const textBlock: Anthropic.TextBlockParam = { type: "text", text }
			const imageBlocks: Anthropic.ImageBlockParam[] = formatImagesIntoBlocks(images)
			// Placing images after text leads to better results
			return [textBlock, ...imageBlocks]
		} else {
			return text
		}
	},

	/**
	 * Formats images into image blocks.
	 * @param images - Optional array of image data URLs.
	 * @returns An array of image blocks.
	 */
	imageBlocks: (images?: string[]): Anthropic.ImageBlockParam[] => {
		return formatImagesIntoBlocks(images)
	},

	/**
	 * Formats a list of files into a string representation.
	 * @param absolutePath - The absolute path of the directory.
	 * @param files - Array of file paths.
	 * @param didHitLimit - Boolean indicating if the file list was truncated.
	 * @returns A formatted string of file paths.
	 */
	formatFilesList: (absolutePath: string, files: string[], didHitLimit: boolean): string => {
		const sorted = files
			.map((file) => {
				// convert absolute path to relative path
				const relativePath = path.relative(absolutePath, file).toPosix()
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
			// Sort so files are listed under their respective directories to make it clear what files are children of what directories. Since we build file list top down, even if file list is truncated it will show directories that cline can then explore further.
			.sort((a, b) => {
				const aParts = a.split("/") // only works if we use toPosix first
				const bParts = b.split("/")
				for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
					if (aParts[i] !== bParts[i]) {
						// If one is a directory and the other isn't at this level, sort the directory first
						if (i + 1 === aParts.length && i + 1 < bParts.length) {
							return -1
						}
						if (i + 1 === bParts.length && i + 1 < aParts.length) {
							return 1
						}
						// Otherwise, sort alphabetically
						return aParts[i].localeCompare(bParts[i], undefined, { numeric: true, sensitivity: "base" })
					}
				}
				// If all parts are the same up to the length of the shorter path,
				// the shorter one comes first
				return aParts.length - bParts.length
			})
		if (didHitLimit) {
			return `${sorted.join(
				"\n"
			)}\n\n(File list truncated. Use list_files on specific subdirectories if you need to explore further.)`
		} else if (sorted.length === 0 || (sorted.length === 1 && sorted[0] === "")) {
			return "No files found."
		} else {
			return sorted.join("\n")
		}
	},

	/**
	 * Creates a pretty patch (diff) between two strings.
	 * @param filename - The name of the file being diffed.
	 * @param oldStr - The original string.
	 * @param newStr - The new string to compare against.
	 * @returns A string representing the diff in a pretty format.
	 */
	createPrettyPatch: (filename = "file", oldStr?: string, newStr?: string) => {
		// strings cannot be undefined or diff throws exception
		const patch = diff.createPatch(filename.toPosix(), oldStr || "", newStr || "")
		const lines = patch.split("\n")
		const prettyPatchLines = lines.slice(4)
		return prettyPatchLines.join("\n")
	},
}

/**
 * Formats an array of image data URLs into image blocks.
 * @param images - Optional array of image data URLs.
 * @returns An array of image blocks.
 */
const formatImagesIntoBlocks = (images?: string[]): Anthropic.ImageBlockParam[] => {
	return images
		? images.map((dataUrl) => {
				// data:image/png;base64,base64string
				const [rest, base64] = dataUrl.split(",")
				const mimeType = rest.split(":")[1].split(";")[0]
				return {
					type: "image",
					source: { type: "base64", media_type: mimeType, data: base64 },
				} as Anthropic.ImageBlockParam
		  })
		: []
}

/**
 * A string containing instructions for tool use formatting.
 */
const toolUseInstructionsReminder = `# Reminder: Instructions for Tool Use

Tool uses are formatted using XML-style tags. The tool name is enclosed in opening and closing tags, and each parameter is similarly enclosed within its own set of tags. Here's the structure:

<tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</tool_name>

For example:

<attempt_completion>
<result>
I have completed the task...
</result>
</attempt_completion>

Always adhere to this format for all tool uses to ensure proper parsing and execution.`
