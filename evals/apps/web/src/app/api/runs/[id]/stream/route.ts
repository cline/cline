import type { NextRequest } from "next/server"

import { findRun } from "@evals/db"
import { IpcMessageType } from "@evals/types"
import { IpcClient } from "@evals/ipc"

import { SSEStream } from "@/lib/server/sse-stream"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const requestId = crypto.randomUUID()
	const stream = new SSEStream()
	const run = await findRun(Number(id))
	const client = new IpcClient(run.socketPath, () => {})

	const write = async (data: string | object) => {
		// console.log(`[stream#${requestId}] write`, data)
		const success = await stream.write(data)

		if (!success) {
			client.disconnect()
		}
	}

	console.log(`[stream#${requestId}] connect`)
	client.on(IpcMessageType.Connect, () => write("connect"))
	client.on(IpcMessageType.Disconnect, () => write("disconnect"))
	client.on(IpcMessageType.TaskEvent, write)

	request.signal.addEventListener("abort", () => {
		console.log(`[stream#${requestId}] abort`)
		client.disconnect()
		stream.close().catch(() => {})
	})

	return stream.getResponse()
}
