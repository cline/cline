export interface CompletionTestCase {
	original: string // Text with |cur| and |till| markers
	completion: string // Text to insert/overwrite
	appliedCompletion?: string | null
	cursorMarker?: string
	tillMarker?: string
}

export interface ProcessedTestCase {
	input: {
		lastLineOfCompletionText: string
		currentText: string
		cursorPosition: number
	}
	expectedResult: {
		completionText: string
		range?: {
			start: number
			end: number
		}
	}
}

/**
 * Transforms human-readable test case into input and expected results.
 *
 * - `original`: Your original text with |cur| marking where the cursor is before completion,
 *      and |till| marking where the cursor should be after accepting completion (and this is
 *      the end of the actual applied completion)
 * - `completion`: LLM completion output
 * - `appliedCompletion` (optional):  part of the LLM completion output that is actually applied
 *      (written between |cur| and |till| in the original)
 *
 * For example, you have this line:
 *
 *     console.log("<cursor here>");
 *
 * and expect it to be completed this way:
 *
 *     console.log("foo: ", bar<cursor here>);
 *
 * with your completion coming from LLM being: `'foo: ", bar<cursor here>);'`
 *
 * Your input to this function should be:
 * - original: `'console.log("|cur|"|till|);'`
 * - completion: `'foo: ", bar);'`
 * - appliedCompletion: `'foo: ", bar'`
 *
 * Output: input and expected output of {@link core/autocomplete/util/processSingleLineCompletion/processSingleLineCompletion|processSingleLineCompletion()}
 *
 */
export function processTestCase({
	original,
	completion,
	appliedCompletion = null,
	cursorMarker = "|cur|",
	tillMarker = "|till|",
}: CompletionTestCase): ProcessedTestCase {
	// Validate cursor marker
	if (!original.includes(cursorMarker)) {
		throw new Error("Cursor marker not found in original text")
	}

	const cursorPos = original.indexOf(cursorMarker)
	original = original.replace(cursorMarker, "")

	let tillPos = original.indexOf(tillMarker)
	if (tillPos < 0) {
		tillPos = cursorPos
	} else {
		original = original.replace(tillMarker, "")
	}

	// Calculate currentText based on what's between cursor and till marker
	const currentText = original.substring(cursorPos)

	return {
		input: {
			lastLineOfCompletionText: completion,
			currentText,
			cursorPosition: cursorPos,
		},
		expectedResult: {
			completionText: appliedCompletion || completion,
			range:
				cursorPos === tillPos
					? undefined
					: {
							start: cursorPos,
							end: tillPos,
						},
		},
	}
}
