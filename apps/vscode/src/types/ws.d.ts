declare module "ws" {
	class WebSocket {
		constructor(url: string)
		on(event: "open", listener: () => void): this
		on(event: "error", listener: (error: Error) => void): this
		on(event: "close", listener: () => void): this
		on(event: "message", listener: (data: WebSocket.Data) => void): this
		send(data: string): void
		close(): void
	}

	namespace WebSocket {
		export type Data = string | Buffer | ArrayBuffer | Buffer[]
	}

	export default WebSocket
}
