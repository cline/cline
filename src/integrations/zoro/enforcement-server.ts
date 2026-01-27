import express, { Request, Response } from 'express'
import cors from 'cors'
import type { Controller } from '../../core/controller'
import {
	EnforcementRequest,
	EnforcementResponse,
	ExecuteTaskResponse,
	validateEnforcementRequest,
	validateExecuteTaskRequest,
} from './types'
import { verifyStep, verifySubstep, verifyRule, executeTask, setController } from './delegates'

const app = express()
const PORT = 48820

app.use(cors())
app.use(express.json())

app.post('/execute-step', async (req: Request, res: Response) => {
	const validation = validateEnforcementRequest(req.body)
	if (!validation.valid) {
		return res.status(400).json({ error: validation.error })
	}

	const body = validation.data!
	console.log('POST /execute-step received:', { chat_id: body.chat_id, step_id: body.step_id })

	try {
		const response = await verifyStep(body)
		return res.status(200).json(response)
	} catch (error) {
		console.error('Error in /execute-step:', error)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

app.post('/execute-substep', async (req: Request, res: Response) => {
	const validation = validateEnforcementRequest(req.body)
	if (!validation.valid) {
		return res.status(400).json({ error: validation.error })
	}

	const body = validation.data!
	console.log('POST /execute-substep received:', {
		chat_id: body.chat_id,
		step_id: body.step_id,
		substep_id: body.substep_id,
	})

	try {
		const response = await verifySubstep(body)
		return res.status(200).json(response)
	} catch (error) {
		console.error('Error in /execute-substep:', error)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

app.post('/execute-rule', async (req: Request, res: Response) => {
	const validation = validateEnforcementRequest(req.body)
	if (!validation.valid) {
		return res.status(400).json({ error: validation.error })
	}

	const body = validation.data!
	console.log('POST /execute-rule received:', {
		chat_id: body.chat_id,
		step_id: body.step_id,
		rule_id: body.rule_id,
	})

	try {
		const response = await verifyRule(body)
		return res.status(200).json(response)
	} catch (error) {
		console.error('Error in /execute-rule:', error)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

app.post('/execute-task', async (req: Request, res: Response) => {
	const validation = validateExecuteTaskRequest(req.body)
	if (!validation.valid) {
		return res.status(400).json({ error: validation.error })
	}

	const { task, context } = validation.data!
	console.log('POST /execute-task received:', { task, context })

	try {
		const response = await executeTask(task, context)
		return res.status(200).json(response)
	} catch (error) {
		console.error('Error in /execute-task:', error)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

app.get('/health', (req: Request, res: Response) => {
	res.status(200).json({ status: 'ok', service: 'zoro-enforcement', port: PORT })
})

export function startEnforcementServer(controller: Controller) {
	setController(controller)
	
	app.listen(PORT, '0.0.0.0', () => {
		console.log(`🔧 Zoro Enforcement Server running on http://localhost:${PORT}`)
		console.log(`   - POST /execute-step`)
		console.log(`   - POST /execute-substep`)
		console.log(`   - POST /execute-rule`)
		console.log(`   - POST /execute-task`)
		console.log(`   - GET  /health`)
	})
}
