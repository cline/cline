import { SizeEstimate } from "../utils/content-size"

/**
 * Error thrown when content would exceed the model's context window limit
 */
export class ContentTooLargeError extends Error {
	constructor(
		public details: {
			type: "file" | "terminal"
			path?: string
			command?: string
			size: SizeEstimate
		},
	) {
		super("Content too large for context window")
		this.name = "ContentTooLargeError"
	}
}
