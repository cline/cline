import { randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Logger } from "@/shared/services/Logger"

/** A sandbox a cloud start created whose first turn the sandbox has not yet accepted. */
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
const HEARTBEAT_MS = 20_000
/** A journal not refreshed for this long belongs to a host that is gone, even if its pid is in use again. */
export const JOURNAL_STALE_MS = 60_000

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

/**
 * Write-ahead record of the sandboxes this extension host is starting, so a
 * later host can delete them if this one exits first. A terminating extension
 * host cannot reach the network, so it cannot clean them up itself.
 *
 * Each extension-host lifetime writes its own file, `<pid>-<lifetime id>.json`,
 * so concurrent windows never overwrite each other's records and a later host
 * that is given the same pid never mistakes an old file for its own. The file
 * is refreshed while it has records, so a live pid on a stale file reads as a
 * pid reused by an unrelated process.
 */
export class PendingStartJournal {
	private readonly fileName = `${process.pid}-${randomUUID()}.json`
	private readonly records = new Map<string, PendingStartRecord>()
	private heartbeat: NodeJS.Timeout | undefined

	constructor(
		private readonly dir: string,
		private readonly now: () => number = Date.now,
	) {}

	add(record: PendingStartRecord): void {
		this.records.set(record.sessionId, record)
		this.write()
	}

	remove(sessionId: string): void {
		if (this.records.delete(sessionId)) this.write()
	}

	/** Stops refreshing the file but keeps it, so the next extension host can recover what is left. */
	stop(): void {
		clearInterval(this.heartbeat)
		this.heartbeat = undefined
	}

	/**
	 * Journals whose host lifetime has ended: its process exited, it is an
	 * earlier lifetime of this process's pid, or it stopped being refreshed.
	 * `liveOwners` is set when a journal was skipped because its host still runs.
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
			if (pid !== process.pid && isProcessAlive(pid) && !this.isStale(file)) {
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

	private isStale(file: string): boolean {
		try {
			return this.now() - statSync(file).mtimeMs > JOURNAL_STALE_MS
		} catch {
			return false
		}
	}

	private write(): void {
		const file = path.join(this.dir, this.fileName)
		try {
			if (this.records.size === 0) {
				this.stop()
				rmSync(file, { force: true })
				return
			}
			mkdirSync(this.dir, { recursive: true })
			writeFileSync(file, JSON.stringify([...this.records.values()]))
			if (!this.heartbeat) {
				this.heartbeat = setInterval(() => {
					const time = new Date(this.now())
					try {
						utimesSync(file, time, time)
					} catch {}
				}, HEARTBEAT_MS)
				this.heartbeat.unref?.()
			}
		} catch (error) {
			Logger.warn("[CloudSessions] Failed to record pending cloud starts:", error)
		}
	}
}
