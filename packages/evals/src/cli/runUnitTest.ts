import * as path from "path"

import { execa, parseCommandString } from "execa"
import psTree from "ps-tree"

import { type Task } from "../db/index.js"
import { type ExerciseLanguage, exercisesPath } from "../exercises/index.js"

const UNIT_TEST_TIMEOUT = 2 * 60 * 1_000

const testCommands: Record<ExerciseLanguage, { commands: string[]; timeout?: number; cwd?: string }> = {
	go: { commands: ["go test"] },
	java: { commands: ["./gradlew test"] },
	javascript: { commands: ["pnpm install", "pnpm test"] },
	python: { commands: ["uv run python3 -m pytest -o markers=task *_test.py"] },
	rust: { commands: ["cargo test"] },
}

export const runUnitTest = async ({ task }: { task: Task }) => {
	const cmd = testCommands[task.language]
	const exercisePath = path.resolve(exercisesPath, task.language, task.exercise)
	const cwd = cmd.cwd ? path.resolve(exercisePath, cmd.cwd) : exercisePath
	const commands = cmd.commands.map((cs) => parseCommandString(cs))
	const tag = `cli#runUnitTest | ${task.language} / ${task.exercise}`

	let passed = true

	for (const command of commands) {
		try {
			const subprocess = execa({ cwd, shell: true, reject: false })`${command}`

			const timeout = setTimeout(async () => {
				const descendants = await new Promise<number[]>((resolve, reject) => {
					psTree(subprocess.pid!, (err, children) => {
						if (err) {
							reject(err)
						}

						resolve(children.map((p) => parseInt(p.PID)))
					})
				})

				console.log(
					`${Date.now()} [${tag}] "${command.join(" ")}": unit tests timed out, killing ${subprocess.pid} + ${JSON.stringify(descendants)}`,
				)

				if (descendants.length > 0) {
					for (const descendant of descendants) {
						try {
							console.log(`${Date.now()} [${tag}] killing ${descendant}`)

							await execa`kill -9 ${descendant}`
						} catch (error) {
							console.error(`${Date.now()} [${tag}] Error killing descendant processes:`, error)
						}
					}
				}

				console.log(`${Date.now()} [${tag}] killing ${subprocess.pid}`)

				try {
					await execa`kill -9 ${subprocess.pid!}`
				} catch (error) {
					console.error(`${Date.now()} [${tag}] Error killing process:`, error)
				}
			}, UNIT_TEST_TIMEOUT)

			const result = await subprocess

			clearTimeout(timeout)

			if (result.failed) {
				passed = false
				break
			}
		} catch (error) {
			console.error(`${Date.now()} [${tag}]`, error)
			passed = false
			break
		}
	}

	return passed
}
