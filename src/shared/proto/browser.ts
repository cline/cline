// Code generated by protoc-gen-ts_proto. DO NOT EDIT.
// versions:
//   protoc-gen-ts_proto  v2.7.0
//   protoc               v6.30.1
// source: browser.proto

/* eslint-disable */
import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire"
import { EmptyRequest, StringRequest } from "./common"

export const protobufPackage = "cline"

export interface BrowserConnectionInfo {
	isConnected: boolean
	isRemote: boolean
	host?: string | undefined
}

export interface BrowserConnection {
	success: boolean
	message: string
	endpoint?: string | undefined
}

function createBaseBrowserConnectionInfo(): BrowserConnectionInfo {
	return { isConnected: false, isRemote: false, host: undefined }
}

export const BrowserConnectionInfo: MessageFns<BrowserConnectionInfo> = {
	encode(message: BrowserConnectionInfo, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
		if (message.isConnected !== false) {
			writer.uint32(8).bool(message.isConnected)
		}
		if (message.isRemote !== false) {
			writer.uint32(16).bool(message.isRemote)
		}
		if (message.host !== undefined) {
			writer.uint32(26).string(message.host)
		}
		return writer
	},

	decode(input: BinaryReader | Uint8Array, length?: number): BrowserConnectionInfo {
		const reader = input instanceof BinaryReader ? input : new BinaryReader(input)
		let end = length === undefined ? reader.len : reader.pos + length
		const message = createBaseBrowserConnectionInfo()
		while (reader.pos < end) {
			const tag = reader.uint32()
			switch (tag >>> 3) {
				case 1: {
					if (tag !== 8) {
						break
					}

					message.isConnected = reader.bool()
					continue
				}
				case 2: {
					if (tag !== 16) {
						break
					}

					message.isRemote = reader.bool()
					continue
				}
				case 3: {
					if (tag !== 26) {
						break
					}

					message.host = reader.string()
					continue
				}
			}
			if ((tag & 7) === 4 || tag === 0) {
				break
			}
			reader.skip(tag & 7)
		}
		return message
	},

	fromJSON(object: any): BrowserConnectionInfo {
		return {
			isConnected: isSet(object.isConnected) ? globalThis.Boolean(object.isConnected) : false,
			isRemote: isSet(object.isRemote) ? globalThis.Boolean(object.isRemote) : false,
			host: isSet(object.host) ? globalThis.String(object.host) : undefined,
		}
	},

	toJSON(message: BrowserConnectionInfo): unknown {
		const obj: any = {}
		if (message.isConnected !== false) {
			obj.isConnected = message.isConnected
		}
		if (message.isRemote !== false) {
			obj.isRemote = message.isRemote
		}
		if (message.host !== undefined) {
			obj.host = message.host
		}
		return obj
	},

	create<I extends Exact<DeepPartial<BrowserConnectionInfo>, I>>(base?: I): BrowserConnectionInfo {
		return BrowserConnectionInfo.fromPartial(base ?? ({} as any))
	},
	fromPartial<I extends Exact<DeepPartial<BrowserConnectionInfo>, I>>(object: I): BrowserConnectionInfo {
		const message = createBaseBrowserConnectionInfo()
		message.isConnected = object.isConnected ?? false
		message.isRemote = object.isRemote ?? false
		message.host = object.host ?? undefined
		return message
	},
}

function createBaseBrowserConnection(): BrowserConnection {
	return { success: false, message: "", endpoint: undefined }
}

export const BrowserConnection: MessageFns<BrowserConnection> = {
	encode(message: BrowserConnection, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
		if (message.success !== false) {
			writer.uint32(8).bool(message.success)
		}
		if (message.message !== "") {
			writer.uint32(18).string(message.message)
		}
		if (message.endpoint !== undefined) {
			writer.uint32(26).string(message.endpoint)
		}
		return writer
	},

	decode(input: BinaryReader | Uint8Array, length?: number): BrowserConnection {
		const reader = input instanceof BinaryReader ? input : new BinaryReader(input)
		let end = length === undefined ? reader.len : reader.pos + length
		const message = createBaseBrowserConnection()
		while (reader.pos < end) {
			const tag = reader.uint32()
			switch (tag >>> 3) {
				case 1: {
					if (tag !== 8) {
						break
					}

					message.success = reader.bool()
					continue
				}
				case 2: {
					if (tag !== 18) {
						break
					}

					message.message = reader.string()
					continue
				}
				case 3: {
					if (tag !== 26) {
						break
					}

					message.endpoint = reader.string()
					continue
				}
			}
			if ((tag & 7) === 4 || tag === 0) {
				break
			}
			reader.skip(tag & 7)
		}
		return message
	},

	fromJSON(object: any): BrowserConnection {
		return {
			success: isSet(object.success) ? globalThis.Boolean(object.success) : false,
			message: isSet(object.message) ? globalThis.String(object.message) : "",
			endpoint: isSet(object.endpoint) ? globalThis.String(object.endpoint) : undefined,
		}
	},

	toJSON(message: BrowserConnection): unknown {
		const obj: any = {}
		if (message.success !== false) {
			obj.success = message.success
		}
		if (message.message !== "") {
			obj.message = message.message
		}
		if (message.endpoint !== undefined) {
			obj.endpoint = message.endpoint
		}
		return obj
	},

	create<I extends Exact<DeepPartial<BrowserConnection>, I>>(base?: I): BrowserConnection {
		return BrowserConnection.fromPartial(base ?? ({} as any))
	},
	fromPartial<I extends Exact<DeepPartial<BrowserConnection>, I>>(object: I): BrowserConnection {
		const message = createBaseBrowserConnection()
		message.success = object.success ?? false
		message.message = object.message ?? ""
		message.endpoint = object.endpoint ?? undefined
		return message
	},
}

export type BrowserServiceDefinition = typeof BrowserServiceDefinition
export const BrowserServiceDefinition = {
	name: "BrowserService",
	fullName: "cline.BrowserService",
	methods: {
		getBrowserConnectionInfo: {
			name: "getBrowserConnectionInfo",
			requestType: EmptyRequest,
			requestStream: false,
			responseType: BrowserConnectionInfo,
			responseStream: false,
			options: {},
		},
		testBrowserConnection: {
			name: "testBrowserConnection",
			requestType: StringRequest,
			requestStream: false,
			responseType: BrowserConnection,
			responseStream: false,
			options: {},
		},
		discoverBrowser: {
			name: "discoverBrowser",
			requestType: EmptyRequest,
			requestStream: false,
			responseType: BrowserConnection,
			responseStream: false,
			options: {},
		},
	},
} as const

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined

export type DeepPartial<T> = T extends Builtin
	? T
	: T extends globalThis.Array<infer U>
		? globalThis.Array<DeepPartial<U>>
		: T extends ReadonlyArray<infer U>
			? ReadonlyArray<DeepPartial<U>>
			: T extends {}
				? { [K in keyof T]?: DeepPartial<T[K]> }
				: Partial<T>

type KeysOfUnion<T> = T extends T ? keyof T : never
export type Exact<P, I extends P> = P extends Builtin
	? P
	: P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never }

function isSet(value: any): boolean {
	return value !== null && value !== undefined
}

export interface MessageFns<T> {
	encode(message: T, writer?: BinaryWriter): BinaryWriter
	decode(input: BinaryReader | Uint8Array, length?: number): T
	fromJSON(object: any): T
	toJSON(message: T): unknown
	create<I extends Exact<DeepPartial<T>, I>>(base?: I): T
	fromPartial<I extends Exact<DeepPartial<T>, I>>(object: I): T
}
