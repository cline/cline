/**
 * Web API Polyfills for Node.js environments
 *
 * This file provides polyfills for browser APIs that may not be available
 * in Node.js environments like code-server.
 *
 * Fixes #8381: code-server compatibility broken since v3.28 - "File is not defined"
 */

// Only polyfill if we're in a Node.js environment without these globals
const isNodeWithoutWebAPIs = typeof globalThis.File === "undefined"

if (isNodeWithoutWebAPIs) {
	try {
		// Node.js 18+ has these in the 'buffer' and 'stream/web' modules
		// For older versions, we create minimal polyfills

		// Blob polyfill - Node.js 18+ has this built-in
		if (typeof globalThis.Blob === "undefined") {
			// Use Node.js buffer-based Blob if available
			try {
				const { Blob } = require("node:buffer")
				;(globalThis as any).Blob = Blob
			} catch {
				// Minimal Blob polyfill for very old Node.js versions
				class BlobPolyfill {
					private parts: Uint8Array[]
					readonly type: string
					readonly size: number

					constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
						this.parts = parts.map((part) => {
							if (part instanceof Uint8Array) {
								return part
							}
							if (typeof part === "string") {
								return new TextEncoder().encode(part)
							}
							if (ArrayBuffer.isView(part)) {
								return new Uint8Array(part.buffer, part.byteOffset, part.byteLength)
							}
							if (part instanceof ArrayBuffer) {
								return new Uint8Array(part)
							}
							return new Uint8Array(0)
						})
						this.type = options?.type || ""
						this.size = this.parts.reduce((acc, part) => acc + part.length, 0)
					}

					async arrayBuffer(): Promise<ArrayBuffer> {
						const buffer = new Uint8Array(this.size)
						let offset = 0
						for (const part of this.parts) {
							buffer.set(part, offset)
							offset += part.length
						}
						return buffer.buffer
					}

					async text(): Promise<string> {
						const buffer = await this.arrayBuffer()
						return new TextDecoder().decode(buffer)
					}

					slice(start?: number, end?: number, contentType?: string): BlobPolyfill {
						// Simplified slice implementation
						return new BlobPolyfill([new Uint8Array(0)], { type: contentType })
					}

					stream(): ReadableStream {
						throw new Error("Blob.stream() not implemented in polyfill")
					}
				}
				;(globalThis as any).Blob = BlobPolyfill
			}
		}

		// File polyfill - extends Blob with name and lastModified
		if (typeof globalThis.File === "undefined") {
			class FilePolyfill extends (globalThis as any).Blob {
				readonly name: string
				readonly lastModified: number

				constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag) {
					super(fileBits, options)
					this.name = fileName
					this.lastModified = options?.lastModified ?? Date.now()
				}
			}
			;(globalThis as any).File = FilePolyfill
		}

		// FormData polyfill
		if (typeof globalThis.FormData === "undefined") {
			try {
				// Try to use undici's FormData which is included in Node.js 18+
				const { FormData } = require("undici")
				;(globalThis as any).FormData = FormData
			} catch {
				// Minimal FormData polyfill
				class FormDataPolyfill {
					private data: Map<string, { value: any; filename?: string }[]> = new Map()

					append(name: string, value: any, filename?: string): void {
						const existing = this.data.get(name) || []
						existing.push({ value, filename })
						this.data.set(name, existing)
					}

					delete(name: string): void {
						this.data.delete(name)
					}

					get(name: string): FormDataEntryValue | null {
						const values = this.data.get(name)
						return values?.[0]?.value ?? null
					}

					getAll(name: string): FormDataEntryValue[] {
						const values = this.data.get(name)
						return values?.map((v) => v.value) ?? []
					}

					has(name: string): boolean {
						return this.data.has(name)
					}

					set(name: string, value: any, filename?: string): void {
						this.data.set(name, [{ value, filename }])
					}

					*entries(): IterableIterator<[string, FormDataEntryValue]> {
						for (const [key, values] of this.data.entries()) {
							for (const { value } of values) {
								yield [key, value]
							}
						}
					}

					*keys(): IterableIterator<string> {
						for (const key of this.data.keys()) {
							yield key
						}
					}

					*values(): IterableIterator<FormDataEntryValue> {
						for (const values of this.data.values()) {
							for (const { value } of values) {
								yield value
							}
						}
					}

					[Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]> {
						return this.entries()
					}

					forEach(
						callback: (value: FormDataEntryValue, key: string, parent: FormDataPolyfill) => void,
						thisArg?: any,
					): void {
						for (const [key, value] of this.entries()) {
							callback.call(thisArg, value, key, this)
						}
					}
				}
				;(globalThis as any).FormData = FormDataPolyfill
			}
		}

		console.debug("Web API polyfills loaded for Node.js environment (code-server compatibility)")
	} catch (error) {
		console.warn("Failed to load web API polyfills:", error)
	}
}

// Export a flag to indicate polyfills were processed
export const webApiPolyfillsLoaded = true
