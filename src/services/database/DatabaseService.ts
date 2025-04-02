import * as path from 'path'
import * as vscode from 'vscode'
import * as sqlite3 from 'sqlite3'
import { promisify } from 'util'
import * as fs from 'fs'

export class DatabaseService {
    private static instance: DatabaseService
    private db: sqlite3.Database
    private dbPath: string
    private runAsync: (sql: string, params?: any[]) => Promise<void>
    private getAsync: (sql: string, params?: any[]) => Promise<any>
    private allAsync: (sql: string, params?: any[]) => Promise<any[]>
    private static extensionContext: vscode.ExtensionContext

    public static setExtensionContext(context: vscode.ExtensionContext) {
        DatabaseService.extensionContext = context
    }

    private constructor() {
        if (!DatabaseService.extensionContext) {
            throw new Error('Extension context not set. Call DatabaseService.setExtensionContext() first.')
        }

        // Create a database file in the extension's global storage
        this.dbPath = path.join(DatabaseService.extensionContext.globalStoragePath, 'autocomplete_cache.db')

        // Ensure the directory exists
        const dbDir = path.dirname(this.dbPath)
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true })
        }

        this.db = new sqlite3.Database(this.dbPath)

        // Promisify database operations
        this.runAsync = promisify(this.db.run.bind(this.db))
        this.getAsync = promisify(this.db.get.bind(this.db))
        this.allAsync = promisify(this.db.all.bind(this.db))
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService()
        }
        return DatabaseService.instance
    }

    public async exec(sql: string): Promise<void> {
        try {
            await this.runAsync(sql)
        } catch (error) {
            console.error('Error executing SQL:', error)
            throw error
        }
    }

    public async prepare(sql: string, params: any[] = []): Promise<any> {
        try {
            return await this.getAsync(sql, params)
        } catch (error) {
            console.error('Error preparing SQL statement:', error)
            throw error
        }
    }

    public async close(): Promise<void> {
        try {
            await new Promise<void>((resolve, reject) => {
                this.db.close((err) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        } catch (error) {
            console.error('Error closing database:', error)
            throw error
        }
    }
}

export default DatabaseService
