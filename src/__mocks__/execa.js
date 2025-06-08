const execa = jest.fn().mockResolvedValue({
	stdout: "",
	stderr: "",
	exitCode: 0,
	failed: false,
	killed: false,
	signal: null,
	timedOut: false,
})

class ExecaError extends Error {
	constructor(message) {
		super(message)
		this.name = "ExecaError"
		this.exitCode = 1
		this.stdout = ""
		this.stderr = message
		this.failed = true
		this.timedOut = false
		this.isCanceled = false
		this.killed = false
		this.signal = null
	}
}

module.exports = {
	execa,
	ExecaError,
}
