export function emitTaskStartedMessage(taskId: string, jsonOutput: boolean): void {
	if (jsonOutput) {
		process.stdout.write(JSON.stringify({ type: "task_started", taskId }) + "\n")
		return
	}

	process.stderr.write(`Task started: ${taskId}\n`)
}
