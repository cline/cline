import prettyBytes from "pretty-bytes"

export function formatSize(bytes?: number) {
	if (bytes === undefined) {
		return "--kb"
	}

	return prettyBytes(bytes)
}
