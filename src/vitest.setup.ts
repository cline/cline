import nock from "nock"

import "./utils/path" // Import to enable String.prototype.toPosix().

// Disable network requests by default for all tests.
nock.disableNetConnect()

export function allowNetConnect(host?: string | RegExp) {
	if (host) {
		nock.enableNetConnect(host)
	} else {
		nock.enableNetConnect()
	}
}

// Global mocks that many tests expect.
global.structuredClone = global.structuredClone || ((obj: any) => JSON.parse(JSON.stringify(obj)))

// Suppress console.log during tests to reduce noise.
// Keep console.error for actual errors.
const originalConsoleLog = console.log
const originalConsoleWarn = console.warn
const originalConsoleInfo = console.info

console.log = () => {}
console.warn = () => {}
console.info = () => {}

afterAll(() => {
	console.log = originalConsoleLog
	console.warn = originalConsoleWarn
	console.info = originalConsoleInfo
})
