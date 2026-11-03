import { randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

/** A sandbox a cloud start created and has not yet sent the first prompt to. */
export interface PendingStartRecord {
	sessionId: string
	/** Account scope (user and organization) the start ran under; only that scope may settle the record. */
	account?: string
	/** Control-plane endpoint the sandbox was created on. */
	endpoint?: string
}

/** Records left by an extension host that has exited, with the means to rewrite what is still unresolved. */
export interface AbandonedJournal {
	records: PendingStartRecord[]
	settle(unresolved: PendingStartRecord[]): void
}

const JOURNAL_FILE = /^(\d+)-([0-9a-f-]+)\.json$/

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		// EPERM means the process exists but belongs to someone else; only ESRCH proves it is gone.
		return (error as NodeJS.ErrnoException).code !== "ESRCH"
	}
}

/**
 * Write-ahead record of the sandboxes this extension host is starting, so a
 * later host can delete them if this one exits first. A terminating extension
 * host cannot reach the network, so it cannot clean them up itself.
 *
 * Each extension-host lifetime writes its own file, `<pid>-<lifetime id>.json`,
 * so concurrent windows never overwrite each other's records and a later host
 * that is given the same pid never mistakes an old file for its own. A file
 * whose pid is alive is never taken: the owner may only be paused, and a pid
 * reused by another process only delays recovery until that process exits.
 */
export class PendingStartJournal {
	private readonly fileName = `${process.pid}-${randomUUID()}.json`
	private readonly records = new Map<string, PendingStartRecord>()

	constructor(private readonly dir: string) {}

	/** Throws when the record cannot be written, so the start fails and cleans up while it still can. */
	add(record: PendingStartRecord): void {
		this.records.set(record.sessionId, record)
		this.write()
	}

	/** Throws when the record cannot be dropped, so a start never sends its prompt while recovery could still delete it. */
	remove(sessionId: string): void {
		if (this.records.delete(sessionId)) this.write()
	}

	/**
	 * Journals whose host lifetime has ended: its process exited, or it is an
	 * earlier lifetime of this process's pid. `liveOwners` is set when a journal
	 * was skipped because its process is still running.
	 */
	abandoned(): { journals: AbandonedJournal[]; liveOwners: boolean } {
		let names: string[]
		try {
			names = readdirSync(this.dir)
		} catch {
			return { journals: [], liveOwners: false }
		}
		const journals: AbandonedJournal[] = []
		let liveOwners = false
		for (const name of names) {
			const match = JOURNAL_FILE.exec(name)
			if (!match || name === this.fileName) continue
			const file = path.join(this.dir, name)
			const pid = Number(match[1])
			if (pid !== process.pid && isProcessAlive(pid)) {
				liveOwners = true
				continue
			}
			let records: PendingStartRecord[] = []
			try {
				const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
				if (Array.isArray(parsed)) {
					records = parsed.filter((record): record is PendingStartRecord => typeof record?.sessionId === "string")
				}
			} catch {}
			journals.push({
				records,
				settle: (unresolved) => {
					try {
						if (unresolved.length > 0) writeFileSync(file, JSON.stringify(unresolved))
						else rmSync(file, { force: true })
					} catch {}
				},
			})
		}
		return { journals, liveOwners }
	}

	private write(): void {
		const file = path.join(this.dir, this.fileName)
		if (this.records.size === 0) {
			rmSync(file, { force: true })
			return
		}
		mkdirSync(this.dir, { recursive: true })
		writeFileSync(file, JSON.stringify([...this.records.values()]))
	}
}
