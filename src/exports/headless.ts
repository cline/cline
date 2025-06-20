/* eslint-disable */
// @ts-nocheck
// Headless API for cline

/**
 * @typedef {Object} HeadlessOptions
 * @property {string} workspacePath
 * @property {Record<string, any>=} config
 */

/**
 * Passes an instruction to the running Cline VS Code extension by writing to a temporary file.
 */
async function runInstruction(instruction, options) {
	try {
		const os = require("os")
		const path = require("path")
		const fs = require("fs").promises

		const tempDir = os.tmpdir()
		const instructionFilePath = path.join(tempDir, "cline-instruction.txt")

		// Write the instruction to the file. The VS Code extension will be watching this file.
		await fs.writeFile(instructionFilePath, instruction)

		return `Instruction sent to Cline UI: "${instruction}"`
	} catch (error) {
		return `Error sending instruction to Cline UI: ${error.message}`
	}
}

// Export runInstruction for CommonJS consumers
module.exports = {
	runInstruction,
}
