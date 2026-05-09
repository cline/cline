type WriteCallback = (error?: Error | null) => void;
type WriteMethod = NodeJS.WriteStream["write"];
type CapturedStream = "stdout" | "stderr";

// Covers CSI, OSC (including OSC52 clipboard writes), and Fe sequences. OSC must precede the Fe catch-all because ] falls in the Fe range.
const ANSI_PATTERN = new RegExp(
	`${String.fromCharCode(27)}(?:\\[[0-?]*[ -/]*[@-~]|\\].*?(?:${String.fromCharCode(27)}\\\\|${String.fromCharCode(7)})|[@-Z\\\\-_])`,
	"g",
);

function isWriteCallback(value: unknown): value is WriteCallback {
	return typeof value === "function";
}

function getWriteCallback(
	encodingOrCallback?: BufferEncoding | WriteCallback,
	callback?: WriteCallback,
): WriteCallback | undefined {
	return isWriteCallback(encodingOrCallback) ? encodingOrCallback : callback;
}

function getWriteEncoding(
	encodingOrCallback?: BufferEncoding | WriteCallback,
): BufferEncoding | undefined {
	return typeof encodingOrCallback === "string"
		? encodingOrCallback
		: undefined;
}

function chunkToText(
	chunk: string | Uint8Array,
	encoding?: BufferEncoding,
): string {
	if (typeof chunk === "string") {
		return chunk;
	}
	return Buffer.from(chunk).toString(encoding);
}

function cleanLine(line: string): string {
	return line.replace(ANSI_PATTERN, "");
}

function createCapturedWrite(stream: CapturedStream): {
	write: WriteMethod;
	flush: () => void;
} {
	let pending = "";
	// Guards against recursion: if console.log/error internally calls process.stdout.write, the re-entrant write is dropped.
	let emitting = false;

	const emitLine = (line: string) => {
		const cleaned = cleanLine(line);
		if (!cleaned) {
			return;
		}
		if (emitting) {
			return;
		}
		emitting = true;
		try {
			if (stream === "stderr") {
				console.error(cleaned);
				return;
			}
			console.log(cleaned);
		} finally {
			emitting = false;
		}
	};

	const write = ((
		chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | WriteCallback,
		callback?: WriteCallback,
	) => {
		const encoding = getWriteEncoding(encodingOrCallback);
		const resolvedCallback = getWriteCallback(encodingOrCallback, callback);
		pending += chunkToText(chunk, encoding)
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n");

		let newlineIndex = pending.indexOf("\n");
		while (newlineIndex !== -1) {
			emitLine(pending.slice(0, newlineIndex));
			pending = pending.slice(newlineIndex + 1);
			newlineIndex = pending.indexOf("\n");
		}

		if (resolvedCallback) {
			process.nextTick(resolvedCallback);
		}
		return true;
	}) as WriteMethod;

	return {
		write,
		flush: () => {
			if (!pending) {
				return;
			}
			emitLine(pending);
			pending = "";
		},
	};
}

export function installTuiStdioCapture(): () => void {
	const originalStdoutWrite = process.stdout.write;
	const originalStderrWrite = process.stderr.write;
	const stdout = createCapturedWrite("stdout");
	const stderr = createCapturedWrite("stderr");
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
