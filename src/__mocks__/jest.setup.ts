import nock from "nock"

nock.disableNetConnect()

export function allowNetConnect(host?: string | RegExp) {
	if (host) {
		nock.enableNetConnect(host)
	} else {
		nock.enableNetConnect()
	}
}

// Mock the logger globally for all tests
jest.mock("../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		fatal: jest.fn(),
		child: jest.fn().mockReturnValue({
			debug: jest.fn(),
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			fatal: jest.fn(),
		}),
	},
}))

// Add toPosix method to String prototype for all tests, mimicking src/utils/path.ts
// This is needed because the production code expects strings to have this method
// Note: In production, this is added via import in the entry point (extension.ts)
export {}

declare global {
	interface String {
		toPosix(): string
	}
}

// Implementation that matches src/utils/path.ts
function toPosixPath(p: string) {
	// Extended-Length Paths in Windows start with "\\?\" to allow longer paths
	// and bypass usual parsing. If detected, we return the path unmodified.
	const isExtendedLengthPath = p.startsWith("\\\\?\\")

	if (isExtendedLengthPath) {
		return p
	}

	return p.replace(/\\/g, "/")
}

if (!String.prototype.toPosix) {
	String.prototype.toPosix = function (this: string): string {
		return toPosixPath(this)
	}
}
