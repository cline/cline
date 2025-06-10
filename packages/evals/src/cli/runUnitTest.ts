import * as path from "path"

import { execa, parseCommandString } from "execa"
import psTree from "ps-tree"

import type { Task } from "../db/index.js"
import { type ExerciseLanguage, EVALS_REPO_PATH } from "../exercises/index.js"

import { Logger } from "./utils.js"

const UNIT_TEST_TIMEOUT = 2 * 60 * 1_000

const testCommands: Record<ExerciseLanguage, { commands: string[]; timeout?: number }> = {
	go: { commands: ["go test"] },
	java: { commands: ["./gradlew test"] },
	javascript: { commands: ["pnpm install", "pnpm test"] },
	python: { commands: ["uv run python3 -m pytest -o markers=task *_test.py"] },
	rust: { commands: ["cargo test"] },
}

type RunUnitTestOptions = {
	task: Task
	logger: Logger
}

export const runUnitTest = async ({ task, logger }: RunUnitTestOptions) => {
	const cmd = testCommands[task.language]
	const cwd = path.resolve(EVALS_REPO_PATH, task.language, task.exercise)
	const commands = cmd.commands.map((cs) => parseCommandString(cs))

	let passed = true

	for (const command of commands) {
		try {
			logger.info(`running "${command.join(" ")}"`)
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

				logger.info(
					`"${command.join(" ")}" timed out, killing ${subprocess.pid} + ${JSON.stringify(descendants)}`,
				)

				if (descendants.length > 0) {
					for (const descendant of descendants) {
						try {
							logger.info(`killing descendant process ${descendant}`)
							await execa`kill -9 ${descendant}`
						} catch (error) {
							logger.error(`failed to kill descendant process ${descendant}:`, error)
						}
					}
				}

				logger.info(`killing main process ${subprocess.pid}`)

				try {
					await execa`kill -9 ${subprocess.pid!}`
				} catch (error) {
					logger.error(`failed to kill main process ${subprocess.pid}:`, error)
				}
			}, UNIT_TEST_TIMEOUT)

			const result = await subprocess

			clearTimeout(timeout)

			if (result.failed) {
				passed = false
				break
			}
		} catch (error) {
			logger.error(`unexpected error:`, error)
			passed = false
			break
		}
	}

	return passed
}
