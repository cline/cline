import { execSync } from "node:child_process"
import iconv from "iconv-lite"

let cachedEncoding: string | undefined

export function getWindowsConsoleEncoding(): string {
	if (process.platform !== "win32") {
		return "utf8"
	}
	if (cachedEncoding !== undefined) {
		return cachedEncoding
	}
	try {
		const output = execSync("chcp", { windowsHide: true }).toString()
		const match = output.match(/:\s*(\d+)/)
		if (match) {
			const codePage = match[1]
			const encoding = codePageToEncoding(codePage)
			if (iconv.encodingExists(encoding)) {
				cachedEncoding = encoding
				return cachedEncoding
			}
		}
	} catch {
		// fall through
	}
	cachedEncoding = "utf8"
	return cachedEncoding
}

function codePageToEncoding(codePage: string): string {
	switch (codePage) {
		case "936":
			return "gbk"
		case "950":
			return "big5"
		case "949":
			return "euc-kr"
		case "932":
			return "shift-jis"
		case "65001":
			return "utf8"
		default:
			return `cp${codePage}`
	}
}
