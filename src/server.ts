/* eslint-disable @typescript-eslint/no-var-requires */
// @ts-nocheck
/**
 * cline/src/server.ts
 * Express server exposing the /task endpoint using cline's headless API.
 */
const express = require("express")
const { runInstruction } = require("./exports/headless")
const app = express()

app.use(express.json())

app.post("/task", async (req, res) => {
	const { instruction } = req.body
	if (!instruction) {
		res.status(400).json({ error: "Missing instruction" })
		return
	}

	try {
		const result = await runInstruction(instruction, {
			workspacePath: process.cwd(),
		})
		res.json({ result })
	} catch (err) {
		res.status(500).json({ error: err?.message || "Internal server error" })
	}
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
	console.log(`Cline API server running on port ${PORT}`)
})
