import * as path from "path"

import { execa, parseCommandString } from "execa"
import psTree from "ps-tree"

import type { Run, Task } from "../db/index.js"
import { type ExerciseLanguage, exercisesPath } from "../exercises/index.js"

import { getTag } from "./utils.js"

const UNIT_TEST_TIMEOUT = 2 * 60 * 1_000

const testCommands: Record<ExerciseLanguage, { commands: string[]; timeout?: number; cwd?: string }> = {
	go: { commands: ["go test"] },
	java: { commands: ["./gradlew test"] },
	javascript: { commands: ["pnpm install", "pnpm test"] },
	python: { commands: ["uv run python3 -m pytest -o markers=task *_test.py"] },
	rust: { commands: ["cargo test"] },
}

export const runUnitTest = async ({ run, task }: { run: Run; task: Task }) => {
	const tag = getTag("runUnitTest", { run, task })
	const log = (message: string, ...args: unknown[]) => console.log(`[${Date.now()} | ${tag}] ${message}`, ...args)
	const logError = (message: string, ...args: unknown[]) =>
		console.error(`[${Date.now()} | ${tag}] ${message}`, ...args)

	const cmd = testCommands[task.language]
	const exercisePath = path.resolve(exercisesPath, task.language, task.exercise)
	const cwd = cmd.cwd ? path.resolve(exercisePath, cmd.cwd) : exercisePath
	const commands = cmd.commands.map((cs) => parseCommandString(cs))

	let passed = true

	for (const command of commands) {
		try {
			log(`running "${command.join(" ")}"`)
			const subprocess = execa({ cwd, shell: "/bin/bash", reject: false })`${command}`
			subprocess.stdout.pipe(process.stdout)
			subprocess.stderr.pipe(process.stderr)

			const timeout = setTimeout(async () => {
				const descendants = await new Promise<number[]>((resolve, reject) => {
					psTree(subprocess.pid!, (err, children) => {
						if (err) {
							reject(err)
						}

						resolve(children.map((p) => parseInt(p.PID)))
					})
				})

				log(`"${command.join(" ")}" timed out, killing ${subprocess.pid} + ${JSON.stringify(descendants)}`)

				if (descendants.length > 0) {
					for (const descendant of descendants) {
						try {
							log(`killing descendant process ${descendant}`)
							await execa`kill -9 ${descendant}`
						} catch (error) {
							logError(`failed to kill descendant process ${descendant}:`, error)
						}
					}
				}

				log(`killing main process ${subprocess.pid}`)

				try {
					await execa`kill -9 ${subprocess.pid!}`
				} catch (error) {
					logError(`failed to kill main process ${subprocess.pid}:`, error)
				}
			}, UNIT_TEST_TIMEOUT)

			const result = await subprocess

			clearTimeout(timeout)

			if (result.failed) {
				passed = false
				break
			}
		} catch (error) {
			logError(`unexpected error:`, error)
			passed = false
			break
		}
	}

	return passed
}
