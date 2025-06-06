export class SSEStream {
	private readonly _stream: TransformStream
	private readonly _writer: WritableStreamDefaultWriter
	private readonly _encoder: TextEncoder
	private _isClosed: boolean = false

	constructor() {
		this._stream = new TransformStream()
		this._writer = this._stream.writable.getWriter()
		this._encoder = new TextEncoder()
	}

	public async write(data: string | object): Promise<boolean> {
		if (this._isClosed) {
			return false
		}

		try {
			const buffer = typeof data === "object" ? JSON.stringify(data) : data
			await this._writer.write(this._encoder.encode(`data: ${buffer}\n\n`))
			return true
		} catch (error) {
			console.error("[SSEStream#write]", error)
			this._isClosed = true
			this.close().catch(() => {})
			return false
		}
	}

	public async close(): Promise<void> {
		if (this._isClosed) {
			return
		}

		this._isClosed = true

		try {
			await this._writer.close()
		} catch (_error) {
			// Writer might already be closed, ignore the error.
		}
	}

	public get isClosed(): boolean {
		return this._isClosed
	}

	public getResponse() {
		return new Response(this._stream.readable, {
			headers: {
				"Content-Type": "text/event-stream",
				Connection: "keep-alive",
				"Cache-Control": "no-cache, no-transform",
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "Cache-Control",
			},
		})
	}
}
