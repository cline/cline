"use server"

import psTree from "ps-tree"
import { exec } from "child_process"

const asyncExec = (command: string): Promise<{ stdout: string; stderr: string }> =>
	new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				reject(error)
			} else {
				resolve({ stdout, stderr })
			}
		})
	})

export const getProcessList = async (pid: number) => {
	try {
		await asyncExec(`ps -p ${pid} -o pid=`)

		return new Promise<number[]>((resolve, reject) => {
			psTree(pid, (err, children) => {
				if (err) {
					reject(err)
				}

				resolve(children.map((p) => parseInt(p.PID)))
			})
		})
	} catch (_) {
		return null
	}
}

export const killProcessTree = async (pid: number) => {
	const descendants = await getProcessList(pid)

	if (descendants === null) {
		return
	}

	if (descendants.length > 0) {
		try {
			await asyncExec(`kill -9 ${descendants.join(" ")}`)
		} catch (error) {
			console.error("Error killing descendant processes:", error)
		}
	}

	try {
		await asyncExec(`kill -9 ${pid}`)
	} catch (error) {
		console.error("Error killing main process:", error)
	}
}
