import fs from "fs/promises"
import { ObjectEncodingOptions, OpenMode, PathLike } from "fs"
import { FileHandle } from "fs/promises"

/**
 * Interface defining the file system functions required by modules like notes.ts.
 * This allows for dependency injection and easier testing.
 */
export interface FsFunctions {
	appendFile: (
		path: PathLike | FileHandle,
		data: string | Uint8Array,
		options?: BufferEncoding | (ObjectEncodingOptions & { mode?: OpenMode; flag?: OpenMode }) | null,
	) => Promise<void>
	readFile: (
		path: PathLike | FileHandle,
		options?: { encoding?: BufferEncoding | null; flag?: OpenMode } | BufferEncoding | null,
	) => Promise<string | Buffer>
	writeFile: (
		path: PathLike | FileHandle,
		data:
			| string
			| Uint8Array
			| Iterable<string | Uint8Array>
			| AsyncIterable<string | Uint8Array>
			| import("stream").Readable,
		options?: BufferEncoding | (ObjectEncodingOptions & { mode?: OpenMode; flag?: OpenMode; flush?: boolean }) | null,
	) => Promise<void>
}

/**
 * Default implementation of FsFunctions using the native fs/promises module.
 * This is injected into modules like notes.ts during normal operation.
 */
export const defaultFileSystem: FsFunctions = {
	appendFile: fs.appendFile,
	readFile: fs.readFile,
	writeFile: fs.writeFile,
}
