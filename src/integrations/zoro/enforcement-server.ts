import cors from "cors"
import express, { Request, Response } from "express"
import type { Controller } from "../../core/controller"
import { verifySubstep, verifySubstepRequirements } from "./verify-engine"
import { setController } from "./cline-execution"
import { generateAndRunTests, testSubstepRequirements } from "./test-engine"
import { generateRequirements } from "./requirements-engine"
import { validateEnforcementRequest } from "./types"

const app = express()
const PORT = 48820

app.use(cors())
app.use(express.json())

// app.post("/execute-step", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	console.log("POST /execute-step received:", { chat_id: body.chat_id, step_id: body.step_id })

// 	try {
// 		const response = await verifyStep(body)
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /execute-step:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

// app.post("/execute-substep", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	console.log("POST /execute-substep received:", {
// 		chat_id: body.chat_id,
// 		step_id: body.step_id,
// 		substep_id: body.substep_id,
// 	})

// 	try {
// 		const response = await verifySubstep(body)
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /execute-substep:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

// app.post("/execute-rule", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	console.log("POST /execute-rule received:", {
// 		chat_id: body.chat_id,
// 		step_id: body.step_id,
// 		rule_id: body.rule_id,
// 	})

// 	try {
// 		const response = await verifyRule(body)
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /execute-rule:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

// app.post("/execute-task", async (req: Request, res: Response) => {
// 	const validation = validateExecuteTaskRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const { task, context } = validation.data!
// 	console.log("POST /execute-task received:", { task, context })

// 	try {
// 		const response = await executeTask(task, context)
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /execute-task:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

// app.post("/do-step", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	console.log("POST /do-step received:", { chat_id: body.chat_id, step_id: body.step_id })

// 	try {
// 		const response = await executeAndVerify(body)
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /do-step:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

// app.post("/do-substep", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	console.log("POST /do-substep received:", {
// 		chat_id: body.chat_id,
// 		step_id: body.step_id,
// 		substep_id: body.substep_id,
// 	})

// 	try {
// 		const response = await executeAndVerify(body)
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /do-substep:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

// app.post("/test-step", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	const cachedVerification = (req.body as any).cached_verification
// 	console.log("POST /test-step received:", {
// 		chat_id: body.chat_id,
// 		step_id: body.step_id,
// 		has_cached_verification: !!cachedVerification,
// 	})

// 	try {
// 		const response = await generateAndRunTests(body, cachedVerification)
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /test-step:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

// app.post("/test-substep", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	const cachedVerification = (req.body as any).cached_verification
// 	console.log("POST /test-substep received:", {
// 		chat_id: body.chat_id,
// 		step_id: body.step_id,
// 		substep_id: body.substep_id,
// 		has_cached_verification: !!cachedVerification,
// 	})

// 	try {
// 		const response = await generateAndRunTests(body, cachedVerification)
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /test-substep:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

/*=====================================New Endpoints=====================================================================*/
// app.post("/verify-step", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	console.log("POST /verify-step received:", { chat_id: body.chat_id, step_id: body.step_id })

// 	try {
// 		// const response = await verifyStep(body) THIS NEEDS TO BE REPLACED
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /verify-step:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })


/** SUBSTEP LEVEL APIS */

// app.post("/create-requirements", async (req: Request, res: Response) => {
// 	const validation = validateEnforcementRequest(req.body)
// 	if (!validation.valid) {
// 		return res.status(400).json({ error: validation.error })
// 	}

// 	const body = validation.data!
// 	console.log("POST /verify-step received:", { chat_id: body.chat_id, step_id: body.step_id })

// 	try {
// 		// const response = await verifyStep(body) THIS NEEDS TO BE REPLACED
// 		return res.status(200).json(response)
// 	} catch (error) {
// 		console.error("Error in /verify-step:", error)
// 		return res.status(500).json({ error: "Internal server error" })
// 	}
// })

app.post("/verify-step", async (req: Request, res: Response) => {
	const { chat_id, node_id, node } = req.body

	console.log("POST /verify-step received:", {
		chat_id,
		node_id,
		node_type: node?.type,
	})

	try {
		const { verifyStep } = await import("./verify-engine")
		const response = await verifyStep(chat_id, node_id, node)
		return res.status(200).json({
			success: true,
			...response
		})
	} catch (error) {
		console.error("[enforcement-server] ❌ Error in /verify-step:")
		console.error("  Request params:", { chat_id, node_id, node_type: node?.type })
		console.error("  Error message:", error instanceof Error ? error.message : String(error))
		console.error("  Stack trace:", error instanceof Error ? error.stack : "No stack")
		console.error("  Full error object:", error)
		
		return res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
			stack: error instanceof Error ? error.stack : undefined,
			context: { chat_id, node_id, node_type: node?.type }
		})
	}
})

app.post("/verify-substep", async (req: Request, res: Response) => {
	const validation = validateEnforcementRequest(req.body)
	if (!validation.valid) {
		return res.status(400).json({ error: validation.error })
	}

	const body = validation.data!
	console.log("POST /verify-substep received:", { chat_id: body.chat_id, step_id: body.step_id })

	try {
		const response = await verifySubstep(body)
		return res.status(200).json(response)
	} catch (error) {
		console.error("Error in /verify-substep:", error)
		return res.status(500).json({ error: "Internal server error" })
	}
})


app.post("/test-substep", async (req: Request, res: Response) => {
	const validation = validateEnforcementRequest(req.body)
	if (!validation.valid) {
		return res.status(400).json({ error: validation.error })
	}

	const body = validation.data!
	const cachedVerification = (req.body as any).cached_verification
	console.log("POST /test-substep received:", {
		chat_id: body.chat_id,
		step_id: body.step_id,
		substep_id: body.substep_id,
		has_cached_verification: !!cachedVerification,
	})

	try {
		const response = await generateAndRunTests(body, cachedVerification)
		return res.status(200).json(response)
	} catch (error) {
		console.error("Error in /test-substep:", error)
		return res.status(500).json({ error: "Internal server error" })
	}
})

app.post("/generate-requirements", async (req: Request, res: Response) => {
	const { step_description, substep_description, rules } = req.body

	console.log("POST /generate-requirements received:", {
		step_description: step_description?.substring(0, 50) + "...",
		substep_description: substep_description?.substring(0, 50) + "...",
		rules_count: rules?.length || 0,
	})

	try {
		const response = await generateRequirements(step_description, substep_description, rules)
		return res.status(200).json(response)
	} catch (error) {
		console.error("[enforcement-server] ❌ Error in /generate-requirements:")
		console.error("  Request params:", { rules_count: rules?.length || 0 })
		console.error("  Error message:", error instanceof Error ? error.message : String(error))
		console.error("  Stack trace:", error instanceof Error ? error.stack : "No stack")
		console.error("  Full error object:", error)
		
		return res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
			stack: error instanceof Error ? error.stack : undefined,
		})
	}
})

app.post("/verify-substep-requirements", async (req: Request, res: Response) => {
	const { chat_id, step_description, substep_description, requirements } = req.body

	console.log("POST /verify-substep-requirements received:", {
		chat_id,
		step_description: step_description?.substring(0, 50) + "...",
		substep_description: substep_description?.substring(0, 50) + "...",
		requirements_count: requirements?.length || 0,
	})

	try {
		const response = await verifySubstepRequirements(
			chat_id,
			step_description,
			substep_description,
			requirements
		)
		return res.status(200).json(response)
	} catch (error) {
		console.error("[enforcement-server] ❌ Error in /verify-substep-requirements:")
		console.error("  Request params:", { chat_id, requirements_count: requirements?.length || 0 })
		console.error("  Error message:", error instanceof Error ? error.message : String(error))
		console.error("  Stack trace:", error instanceof Error ? error.stack : "No stack")
		console.error("  Full error object:", error)
		
		return res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
			stack: error instanceof Error ? error.stack : undefined,
			context: { chat_id, requirements_count: requirements?.length || 0 }
		})
	}
})

app.post("/test-substep-requirements", async (req: Request, res: Response) => {
	const { chat_id, node_id, target_id, step_description, substep_description, requirements } = req.body

	console.log("POST /test-substep-requirements received:", {
		chat_id,
		node_id,
		target_id,
		step_description: step_description?.substring(0, 50) + "...",
		substep_description: substep_description?.substring(0, 50) + "...",
		requirements_count: requirements?.length || 0,
	})

	try {
		const response = await testSubstepRequirements(
			chat_id,
			node_id,
			target_id,
			step_description,
			substep_description,
			requirements
		)
		return res.status(200).json(response)
	} catch (error) {
		console.error("[enforcement-server] ❌ Error in /test-substep-requirements:")
		console.error("  Request params:", { chat_id, node_id, target_id, requirements_count: requirements?.length || 0 })
		console.error("  Error message:", error instanceof Error ? error.message : String(error))
		console.error("  Stack trace:", error instanceof Error ? error.stack : "No stack")
		console.error("  Full error object:", error)
		
		return res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
			stack: error instanceof Error ? error.stack : undefined,
			context: { chat_id, node_id, target_id, requirements_count: requirements?.length || 0 }
		})
	}
})

app.get("/health", (req: Request, res: Response) => {
	res.status(200).json({ status: "ok", service: "zoro-enforcement", port: PORT })
})

export function startEnforcementServer(controller: Controller) {
	// setController(controller)
	setController(controller)

	app.listen(PORT, "0.0.0.0", () => {
		console.log(`🔧 Zoro Enforcement Server running on http://localhost:${PORT}`)
		console.log(`   - POST /verify-step`)
		console.log(`   - POST /verify-substep`)
		console.log(`   - POST /test-substep`)
		console.log(`   - POST /generate-requirements`)
		console.log(`   - POST /verify-substep-requirements`)
		console.log(`   - POST /test-substep-requirements`)
		console.log(`   - GET  /health`)
	})
}
