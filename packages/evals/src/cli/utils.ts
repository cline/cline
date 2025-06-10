import * as fs from "fs"
import * as path from "path"

import { execa } from "execa"

import type { Run, Task } from "../db/index.js"

export const getTag = (caller: string, { run, task }: { run: Run; task?: Task }) =>
	task
		? `${caller} | pid:${process.pid} | run:${run.id} | task:${task.id} | ${task.language}/${task.exercise}`
		: `${caller} | pid:${process.pid} | run:${run.id}`

export const isDockerContainer = () => {
	try {
		return fs.existsSync("/.dockerenv")
	} catch (_error) {
		return false
	}
}

export const resetEvalsRepo = async ({ run, cwd }: { run: Run; cwd: string }) => {
	await execa({ cwd })`git config user.name "Roo Code"`
	await execa({ cwd })`git config user.email "support@roocode.com"`
	await execa({ cwd })`git checkout -f`
	await execa({ cwd })`git clean -fd`
	await execa({ cwd })`git checkout -b runs/${run.id}-${crypto.randomUUID().slice(0, 8)} main`
}

export const commitEvalsRepoChanges = async ({ run, cwd }: { run: Run; cwd: string }) => {
	await execa({ cwd })`git add .`
	await execa({ cwd })`git commit -m ${`Run #${run.id}`} --no-verify`
}

enum LogLevel {
	INFO = "INFO",
	ERROR = "ERROR",
	WARN = "WARN",
	DEBUG = "DEBUG",
}

interface LoggerOptions {
	logDir: string
	filename: string
	tag: string
}

export class Logger {
	private logStream: fs.WriteStream | undefined
	private logFilePath: string
	private tag: string

	constructor({ logDir, filename, tag }: LoggerOptions) {
		this.tag = tag
		this.logFilePath = path.join(logDir, filename)
		this.initializeLogger(logDir)
	}

	private initializeLogger(logDir: string): void {
		try {
			fs.mkdirSync(logDir, { recursive: true })
		} catch (error) {
			console.error(`Failed to create log directory ${logDir}:`, error)
		}

		try {
			this.logStream = fs.createWriteStream(this.logFilePath, { flags: "a" })
		} catch (error) {
			console.error(`Failed to create log file ${this.logFilePath}:`, error)
		}
	}

	private writeToLog(level: LogLevel, message: string, ...args: unknown[]) {
		try {
			const timestamp = new Date().toISOString()

			const logLine = `[${timestamp} | ${level} | ${this.tag}] ${message} ${
				args.length > 0 ? JSON.stringify(args) : ""
			}\n`

			console.log(logLine.trim())

			if (this.logStream) {
				this.logStream.write(logLine)
			}
		} catch (error) {
			console.error(`Failed to write to log file ${this.logFilePath}:`, error)
		}
	}

	public info(message: string, ...args: unknown[]): void {
		this.writeToLog(LogLevel.INFO, message, ...args)
	}

	public error(message: string, ...args: unknown[]): void {
		this.writeToLog(LogLevel.ERROR, message, ...args)
	}

	public warn(message: string, ...args: unknown[]): void {
		this.writeToLog(LogLevel.WARN, message, ...args)
	}

	public debug(message: string, ...args: unknown[]): void {
		this.writeToLog(LogLevel.DEBUG, message, ...args)
	}

	public log(message: string, ...args: unknown[]): void {
		this.info(message, ...args)
	}

	public close(): void {
		if (this.logStream) {
			this.logStream.end()
			this.logStream = undefined
		}
	}
}
