type WriteCallback = (error?: Error | null) => void;
type WriteMethod = NodeJS.WriteStream["write"];

function isWriteCallback(value: unknown): value is WriteCallback {
	return typeof value === "function";
}

function getWriteCallback(
	encodingOrCallback?: BufferEncoding | WriteCallback,
	callback?: WriteCallback,
): WriteCallback | undefined {
	return isWriteCallback(encodingOrCallback) ? encodingOrCallback : callback;
}

function createCapturedWrite(): {
	write: WriteMethod;
	flush: () => void;
} {
	const write = ((
		_chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | WriteCallback,
		callback?: WriteCallback,
	) => {
		const resolvedCallback = getWriteCallback(encodingOrCallback, callback);
		if (resolvedCallback) {
			process.nextTick(resolvedCallback);
		}
		return true;
	}) as WriteMethod;

	return {
		write,
		flush: () => {},
	};
}

export function installTuiStdioCapture(): () => void {
	const originalStdoutWrite = process.stdout.write;
	const originalStderrWrite = process.stderr.write;
	const stdout = createCapturedWrite();
	const stderr = createCapturedWrite();
	let restored = false;

	process.stdout.write = stdout.write;
	process.stderr.write = stderr.write;

	return () => {
		if (restored) {
			return;
		}
		restored = true;
		stdout.flush();
		stderr.flush();
		process.stdout.write = originalStdoutWrite;
		process.stderr.write = originalStderrWrite;
	};
}
