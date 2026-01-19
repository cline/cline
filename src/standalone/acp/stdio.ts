import { Readable, Writable } from "node:stream"
import { ReadableStream, WritableStream } from "node:stream/web"

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
