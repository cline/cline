/**
 * Stream conversion utilities for ACP mode.
 *
 * The ACP SDK's ndJsonStream function expects Web Streams (ReadableStream/WritableStream),
 * but Node.js provides its own stream types. These utilities convert between them.
 *
 * @module acp/streamUtils
 */

import type { Readable, Writable } from "node:stream"

/**
 * Convert a Node.js Writable stream to a Web WritableStream.
 *
 * Used to convert process.stdout for ACP output.
 *
 * @param nodeStream - Node.js Writable stream (e.g., process.stdout)
 * @returns Web WritableStream compatible with ndJsonStream
 */
export function nodeToWebWritable(nodeStream: Writable): WritableStream<Uint8Array> {
	return new WritableStream<Uint8Array>({
		write(chunk) {
			return new Promise<void>((resolve, reject) => {
				nodeStream.write(Buffer.from(chunk), (err) => {
					if (err) {
						reject(err)
					} else {
						resolve()
					}
				})
			})
		},
	})
}

/**
 * Convert a Node.js Readable stream to a Web ReadableStream.
 *
 * Used to convert process.stdin for ACP input.
 *
 * @param nodeStream - Node.js Readable stream (e.g., process.stdin)
 * @returns Web ReadableStream compatible with ndJsonStream
 */
export function nodeToWebReadable(nodeStream: Readable): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			nodeStream.on("data", (chunk: Buffer) => {
				controller.enqueue(new Uint8Array(chunk))
			})
			nodeStream.on("end", () => controller.close())
			nodeStream.on("error", (err) => controller.error(err))
		},
	})
}
