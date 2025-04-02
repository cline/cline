export class SSEStream {
	private readonly _stream: TransformStream
	private readonly _writer: WritableStreamDefaultWriter
	private readonly _encoder: TextEncoder

	constructor() {
		this._stream = new TransformStream()
		this._writer = this._stream.writable.getWriter()
		this._encoder = new TextEncoder()
	}

	public async write(data: string | object) {
		try {
			const buffer = typeof data === "object" ? JSON.stringify(data) : data
			await this._writer.write(this._encoder.encode(`data: ${buffer}\n\n`))
			return true
		} catch (error) {
			console.error("[SSEStream#write]", error)
			this.close().catch(() => {})
			return false
		}
	}

	public close() {
		return this._writer.close()
	}

	public getResponse() {
		return new Response(this._stream.readable, {
			headers: {
				"Content-Type": "text/event-stream",
				Connection: "keep-alive",
				"Cache-Control": "no-cache, no-transform",
			},
		})
	}
}
