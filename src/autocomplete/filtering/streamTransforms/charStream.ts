/**
 * Asynchronous generator that yields characters from the input stream until it encounters
 * an end-of-line character followed by a non-whitespace character.
 *
 * @param {AsyncGenerator<string>} stream - The input stream of characters.
 * @param {string[]} endOfLine - An array of characters considered as end-of-line markers.
 * @param {() => void} fullStop - A function to be called when the generator stops.
 * @yields {string} Characters from the input stream.
 * @returns {AsyncGenerator<string>} An async generator that yields characters.
 */
export async function* onlyWhitespaceAfterEndOfLine(
	stream: AsyncGenerator<string>,
	endOfLine: string[],
	fullStop: () => void,
): AsyncGenerator<string> {
	let pending = ""

	for await (let chunk of stream) {
		chunk = pending + chunk
		pending = ""

		for (let i = 0; i < chunk.length - 1; i++) {
			if (endOfLine.includes(chunk[i]) && chunk[i + 1].trim() === chunk[i + 1]) {
				yield chunk.slice(0, i + 1)
				fullStop()
				return
			}
		}

		if (endOfLine.includes(chunk[chunk.length - 1])) {
			pending = chunk[chunk.length - 1]
			yield chunk.slice(0, chunk.length - 1)
		} else {
			yield chunk
		}
	}
	yield pending
}

/**
 * Yields characters from the stream, stopping if the first character is a newline.
 * @param {AsyncGenerator<string>} stream - The input character stream.
 * @yields {string} Characters from the stream.
 */
export async function* noFirstCharNewline(stream: AsyncGenerator<string>) {
	let first = true
	for await (const char of stream) {
		if (first) {
			first = false
			if (char.startsWith("\n") || char.startsWith("\r")) {
				return
			}
		}
		yield char
	}
}

/**
 * Asynchronously yields characters from the input stream, stopping if a stop token is encountered.
 *
 * @param {AsyncGenerator<string>} stream - The input stream of characters.
 * @param {string[]} stopTokens - Array of tokens that signal when to stop yielding.
 * @yields {string} Characters from the input stream.
 * @returns {AsyncGenerator<string>} An async generator that yields characters until a stop condition is met.
 * @description
 * 1. If no stop tokens are provided, yields all characters from the stream.
 * 2. Otherwise, buffers incoming chunks and checks for stop tokens.
 * 3. Yields characters one by one if no stop token is found at the start of the buffer.
 * 4. Stops yielding and returns if a stop token is encountered.
 * 5. After the stream ends, filters encountered stop tokens in remaining buffer.
 * 6. Yields any remaining buffered characters.
 */
export async function* stopAtStopTokens(stream: AsyncGenerator<string>, stopTokens: string[]): AsyncGenerator<string> {
	if (stopTokens.length === 0) {
		for await (const char of stream) {
			yield char
		}
		return
	}

	const maxStopTokenLength = Math.max(...stopTokens.map((token) => token.length))
	let buffer = ""

	for await (const chunk of stream) {
		buffer += chunk

		while (buffer.length >= maxStopTokenLength) {
			let found = false
			for (const stopToken of stopTokens) {
				if (buffer.startsWith(stopToken)) {
					found = true
					return
				}
			}

			if (!found) {
				yield buffer[0]
				buffer = buffer.slice(1)
			}
		}
	}
	// Filter out the possible stop tokens from remaining buffer
	stopTokens.forEach((token) => {
		buffer = buffer.replace(token, "")
	})

	// Yield any remaining characters in the buffer
	for (const char of buffer) {
		yield char
	}
}

/**
 * Asynchronously yields characters from the input stream.
 * Stops if the beginning of the suffix is detected in the stream.
 */
export async function* stopAtStartOf(
	stream: AsyncGenerator<string>,
	suffix: string,
	sequenceLength: number = 20,
): AsyncGenerator<string> {
	if (suffix.length < sequenceLength) {
		for await (const chunk of stream) {
			yield chunk
		}
		return
	}
	// We use sequenceLength * 1.5 as a heuristic to make sure we don't miss the sequence if the
	// stream is not perfectly aligned with the sequence (small whitespace differences etc).
	const targetPart = suffix.trimStart().slice(0, Math.floor(sequenceLength * 1.5))

	let buffer = ""

	for await (const chunk of stream) {
		buffer += chunk

		// Check if the targetPart contains contains the buffer at any point
		if (buffer.length >= sequenceLength && targetPart.includes(buffer)) {
			return // Stop processing when the sequence is found
		}

		// Yield chunk by chunk, ensuring not to exceed sequenceLength in the buffer
		while (buffer.length > sequenceLength) {
			yield buffer[0]
			buffer = buffer.slice(1)
		}
	}

	// Yield the remaining buffer if it is not contained in the `targetPart`
	if (buffer.length > 0) {
		yield buffer
	}
}
