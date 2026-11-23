import { randomUUID } from "node:crypto"
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PendingStartJournal, type PendingStartRecord } from "./cloud-pending-starts"

const EXITED_PID = 2_147_483_646

let dir: string

beforeEach(() => {
	dir = mkdtempSync(path.join(os.tmpdir(), "cloud-pending-starts-"))
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

function writeJournal(pid: number, records: PendingStartRecord[], ageMs = 0): string {
	const file = path.join(dir, `${pid}-${randomUUID()}.json`)
	writeFileSync(file, JSON.stringify(records))
	const time = new Date(Date.now() - ageMs)
	utimesSync(file, time, time)
	return file
}

describe("PendingStartJournal", () => {
	it("keeps its records in a file of its own until they are removed", () => {
		const journal = new PendingStartJournal(dir)
		journal.add({ sessionId: "ses-a", account: "user:" })
		journal.add({ sessionId: "ses-b", account: "user:" })
		journal.remove("ses-a")

		const [name] = readdirSync(dir)
		expect(name).toMatch(new RegExp(`^${process.pid}-`))
		expect(JSON.parse(readFileSync(path.join(dir, name), "utf8"))).toEqual([{ sessionId: "ses-b", account: "user:" }])
		journal.remove("ses-b")
		expect(readdirSync(dir)).toEqual([])
	})

	it("treats an earlier lifetime of this pid as abandoned instead of skipping or overwriting it", () => {
		const earlier = writeJournal(process.pid, [{ sessionId: "ses-earlier" }])
		const journal = new PendingStartJournal(dir)
		journal.add({ sessionId: "ses-current" })

		const { journals, liveOwners } = journal.abandoned()

		expect(liveOwners).toBe(false)
		expect(journals.map((abandoned) => abandoned.records)).toEqual([[{ sessionId: "ses-earlier" }]])
		expect(JSON.parse(readFileSync(earlier, "utf8"))).toEqual([{ sessionId: "ses-earlier" }])
		expect(readdirSync(dir)).toHaveLength(2)
	})

	it("never takes the journal of a running process, however long ago it was written", () => {
		writeJournal(process.ppid, [{ sessionId: "ses-live" }], 24 * 60 * 60 * 1000)

		expect(new PendingStartJournal(dir).abandoned()).toMatchObject({ journals: [], liveOwners: true })
	})

	it("rewrites an abandoned journal with only what is still unresolved", () => {
		const file = writeJournal(EXITED_PID, [{ sessionId: "ses-done" }, { sessionId: "ses-retry" }])
		const [abandoned] = new PendingStartJournal(dir).abandoned().journals

		abandoned.settle([{ sessionId: "ses-retry" }])
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([{ sessionId: "ses-retry" }])
		abandoned.settle([])
		expect(readdirSync(dir)).toEqual([])
	})
})
