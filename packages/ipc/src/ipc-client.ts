import EventEmitter from "node:events"
import * as crypto from "node:crypto"

import ipc from "node-ipc"

import {
	type TaskCommand,
	type IpcClientEvents,
	type IpcMessage,
	IpcOrigin,
	IpcMessageType,
	ipcMessageSchema,
} from "@roo-code/types"

export class IpcClient extends EventEmitter<IpcClientEvents> {
	private readonly _socketPath: string
	private readonly _id: string
	private readonly _log: (...args: unknown[]) => void
	private _isConnected = false
	private _clientId?: string

	constructor(socketPath: string, log = console.log) {
		super()

		this._socketPath = socketPath
		this._id = `roo-code-evals-${crypto.randomBytes(6).toString("hex")}`
		this._log = log

		ipc.config.silent = true

		ipc.connectTo(this._id, this.socketPath, () => {
			ipc.of[this._id]?.on("connect", () => this.onConnect())
			ipc.of[this._id]?.on("disconnect", () => this.onDisconnect())
			ipc.of[this._id]?.on("message", (data) => this.onMessage(data))
		})
	}

	private onConnect() {
		if (this._isConnected) {
			return
		}

		this.log("[client#onConnect]")
		this._isConnected = true
		this.emit(IpcMessageType.Connect)
	}

	private onDisconnect() {
		if (!this._isConnected) {
			return
		}

		this.log("[client#onDisconnect]")
		this._isConnected = false
		this.emit(IpcMessageType.Disconnect)
	}

	private onMessage(data: unknown) {
		if (typeof data !== "object") {
			this._log("[client#onMessage] invalid data", data)
			return
		}

		const result = ipcMessageSchema.safeParse(data)

		if (!result.success) {
			this.log("[client#onMessage] invalid payload", result.error, data)
			return
		}

		const payload = result.data

		if (payload.origin === IpcOrigin.Server) {
			switch (payload.type) {
				case IpcMessageType.Ack:
					this._clientId = payload.data.clientId
					this.emit(IpcMessageType.Ack, payload.data)
					break
				case IpcMessageType.TaskEvent:
					this.emit(IpcMessageType.TaskEvent, payload.data)
					break
			}
		}
	}

	private log(...args: unknown[]) {
		this._log(...args)
	}

	public sendCommand(command: TaskCommand) {
		const message: IpcMessage = {
			type: IpcMessageType.TaskCommand,
			origin: IpcOrigin.Client,
			clientId: this._clientId!,
			data: command,
		}

		this.sendMessage(message)
	}

	public sendMessage(message: IpcMessage) {
		ipc.of[this._id]?.emit("message", message)
	}

	public disconnect() {
		try {
			ipc.disconnect(this._id)
			// @TODO: Should we set _disconnect here?
		} catch (error) {
			this.log("[client#disconnect] error disconnecting", error)
		}
	}

	public get socketPath() {
		return this._socketPath
	}

	public get clientId() {
		return this._clientId
	}

	public get isConnected() {
		return this._isConnected
	}

	public get isReady() {
		return this._isConnected && this._clientId !== undefined
	}
}
