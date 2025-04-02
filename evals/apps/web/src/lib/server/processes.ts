"use server"

import psTree from "ps-tree"
import { exec } from "child_process"

export const getProcessList = async (pid: number) => {
	const promise = new Promise<string>((resolve, reject) => {
		exec(`ps -p ${pid} -o pid=`, (err, stdout, stderr) => {
			if (err) {
				reject(stderr)
			}

			resolve(stdout)
		})
	})

	try {
		await promise
	} catch (_) {
		return null
	}

	return new Promise<number[]>((resolve, reject) => {
		psTree(pid, (err, children) => {
			if (err) {
				reject(err)
			}

			resolve(children.map((p) => parseInt(p.PID)))
		})
	})
}

export const killProcessTree = async (pid: number) => {
	const descendants = await getProcessList(pid)

	if (descendants === null) {
		return
	}

	if (descendants.length > 0) {
		await exec(`kill -9 ${descendants.join(" ")}`)
	}

	await exec(`kill -9 ${pid}`)
}
