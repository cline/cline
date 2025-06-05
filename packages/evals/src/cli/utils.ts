import * as fs from "fs"

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
