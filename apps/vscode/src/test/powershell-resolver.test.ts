import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import {
	probeWindowsExecutable,
	getFallbackWindowsPowerShellPath,
	getWindowsPowerShellCandidates,
	resetPowerShellResolverCacheForTesting,
	setPowerShellProbeForTesting,
	resolveWindowsPowerShellExecutable,
} from "../utils/powershell"
import { WINDOWS_POWERSHELL_LEGACY_PATH } from "../utils/shell"

describe("PowerShell resolver", () => {
	let originalProgramFiles: string | undefined
	let originalProgramW6432: string | undefined

	beforeEach(() => {
		originalProgramFiles = process.env.ProgramFiles
		originalProgramW6432 = process.env.ProgramW6432
		setPowerShellProbeForTesting(null)
		resetPowerShellResolverCacheForTesting()
	})

	afterEach(() => {
		setPowerShellProbeForTesting(null)
		resetPowerShellResolverCacheForTesting()
		process.env.ProgramFiles = originalProgramFiles
		process.env.ProgramW6432 = originalProgramW6432
	})

	it("prefers absolute pwsh candidate when available", async () => {
		process.env.ProgramFiles = "C:\\Program Files"
		process.env.ProgramW6432 = ""

		const preferredCandidate = getWindowsPowerShellCandidates()[0]
		let probeCalls = 0
		setPowerShellProbeForTesting(async (candidate) => {
			probeCalls += 1
			return candidate === preferredCandidate
		})

		const resolved = await resolveWindowsPowerShellExecutable()
		resolved.should.equal(preferredCandidate)
		probeCalls.should.equal(1)
	})

	it("orders candidates with absolute paths first and command names last, without duplicates", () => {
		process.env.ProgramFiles = "C:\\Program Files"
		delete process.env.ProgramW6432
		const candidates = getWindowsPowerShellCandidates()
		const uniqueCount = new Set(candidates).size

		candidates.length.should.equal(uniqueCount)
		candidates[0].should.equal("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		candidates.should.containEql(WINDOWS_POWERSHELL_LEGACY_PATH)
		candidates.indexOf(WINDOWS_POWERSHELL_LEGACY_PATH).should.be.lessThan(candidates.indexOf("pwsh.exe"))
		candidates.slice(-2).should.deepEqual(["powershell.exe", "powershell"])
	})

	it("falls back to legacy Windows PowerShell path when no candidates resolve", async () => {
		setPowerShellProbeForTesting(async () => false)

		const resolved = await resolveWindowsPowerShellExecutable()
		resolved.should.equal(getFallbackWindowsPowerShellPath())
		resolved.should.equal(WINDOWS_POWERSHELL_LEGACY_PATH)
	})

	it("caches resolved executable and probes only once", async () => {
		process.env.ProgramFiles = "C:\\Program Files"
		process.env.ProgramW6432 = ""

		const preferredCandidate = getWindowsPowerShellCandidates()[0]
		let probeCalls = 0
		setPowerShellProbeForTesting(async () => {
			probeCalls += 1
			return true
		})

		const first = await resolveWindowsPowerShellExecutable()
		const second = await resolveWindowsPowerShellExecutable()

		first.should.equal(preferredCandidate)
		second.should.equal(preferredCandidate)
		probeCalls.should.equal(1)
	})

	it("shares a single probe across concurrent callers", async () => {
		process.env.ProgramFiles = "C:\\Program Files"
		process.env.ProgramW6432 = ""

		const preferredCandidate = getWindowsPowerShellCandidates()[0]
		let probeCalls = 0
		setPowerShellProbeForTesting(async () => {
			probeCalls += 1
			await new Promise((resolve) => setTimeout(resolve, 20))
			return true
		})

		const [a, b, c] = await Promise.all([
			resolveWindowsPowerShellExecutable(),
			resolveWindowsPowerShellExecutable(),
			resolveWindowsPowerShellExecutable(),
		])

		a.should.equal(preferredCandidate)
		b.should.equal(preferredCandidate)
		c.should.equal(preferredCandidate)
		probeCalls.should.equal(1)
	})

	it("times out probing hung candidates", async () => {
		const available = await probeWindowsExecutable("pwsh.exe", 10)
		available.should.equal(false)
	})

	it("cache reset re-runs probing", async () => {
		let probeCalls = 0
		setPowerShellProbeForTesting(async () => {
			probeCalls += 1
			return true
		})

		await resolveWindowsPowerShellExecutable()
		probeCalls.should.equal(1)

		resetPowerShellResolverCacheForTesting()
		setPowerShellProbeForTesting(async () => {
			probeCalls += 1
			return true
		})
		await resolveWindowsPowerShellExecutable()
		probeCalls.should.equal(2)
	})
})