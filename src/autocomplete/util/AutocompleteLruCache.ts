import { Mutex } from 'async-mutex'
import { DatabaseService } from '../../services/database/DatabaseService.js'
import * as vscode from 'vscode'

const SQLITE_MAX_LIKE_PATTERN_LENGTH = 50000

function truncateToLastNBytes(input: string, maxBytes: number): string {
    let bytes = 0
    let startIndex = 0

    for (let i = input.length - 1; i >= 0; i--) {
        bytes += new TextEncoder().encode(input[i]).length
        if (bytes > maxBytes) {
            startIndex = i + 1
            break
        }
    }

    return input.substring(startIndex, input.length)
}

function truncateSqliteLikePattern(input: string) {
    return truncateToLastNBytes(input, SQLITE_MAX_LIKE_PATTERN_LENGTH)
}

export class AutocompleteLruCache {
    private static capacity = 1000
    private mutex = new Mutex()
    private db: DatabaseService
    private static instance: AutocompleteLruCache

    private constructor(context: vscode.ExtensionContext) {
        DatabaseService.setExtensionContext(context)
        this.db = DatabaseService.getInstance()
        this.initializeDatabase()
    }

    private async initializeDatabase(): Promise<void> {
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS autocomplete_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `)
    }

    static initialize(context: vscode.ExtensionContext): AutocompleteLruCache {
        if (!AutocompleteLruCache.instance) {
            AutocompleteLruCache.instance = new AutocompleteLruCache(context)
        }
        return AutocompleteLruCache.instance
    }

    async get(prefix: string): Promise<string | undefined> {
        // NOTE: Right now prompts with different suffixes will be considered the same

        // If the query is "co" and we have "c" -> "ontinue" in the cache,
        // we should return "ntinue" as the completion.
        // Have to make sure we take the key with shortest length
        const result = (await this.db.prepare(
            "SELECT key, value FROM autocomplete_cache WHERE ? LIKE key || '%' ORDER BY LENGTH(key) DESC LIMIT 1",
            [truncateSqliteLikePattern(prefix)]
        )) as { key: string; value: string } | undefined

        // Validate that the cached completion is a valid completion for the prefix
        if (result && result.value.startsWith(prefix.slice(result.key.length))) {
            await this.db.prepare('UPDATE autocomplete_cache SET timestamp = ? WHERE key = ?', [Date.now(), prefix])
            // And then truncate so we aren't writing something that's already there
            return result.value.slice(prefix.length - result.key.length)
        }

        return undefined
    }

    async put(prefix: string, completion: string) {
        const release = await this.mutex.acquire()
        try {
            await this.db.exec('BEGIN TRANSACTION')

            try {
                const result = (await this.db.prepare('SELECT key FROM autocomplete_cache WHERE key = ?', [prefix])) as
                    | { key: string }
                    | undefined

                if (result) {
                    await this.db.prepare('UPDATE autocomplete_cache SET value = ?, timestamp = ? WHERE key = ?', [
                        completion,
                        Date.now(),
                        prefix,
                    ])
                } else {
                    const count = (await this.db.prepare('SELECT COUNT(*) as count FROM autocomplete_cache')) as {
                        count: number
                    }

                    if (count.count >= AutocompleteLruCache.capacity) {
                        await this.db.exec(
                            'DELETE FROM autocomplete_cache WHERE key = (SELECT key FROM autocomplete_cache ORDER BY timestamp ASC LIMIT 1)'
                        )
                    }

                    await this.db.prepare('INSERT INTO autocomplete_cache (key, value, timestamp) VALUES (?, ?, ?)', [
                        prefix,
                        completion,
                        Date.now(),
                    ])
                }

                await this.db.exec('COMMIT')
            } catch (error) {
                await this.db.exec('ROLLBACK')
                throw error
            }
        } catch (e) {
            console.error('Error creating transaction: ', e)
        } finally {
            release()
        }
    }
}

export default AutocompleteLruCache
