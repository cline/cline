import { NextResponse } from "next/server"

import { createTask } from "@evals/db"

export async function POST(request: Request) {
	try {
		const task = await createTask(await request.json())
		return NextResponse.json({ task }, { status: 201 })
	} catch (error) {
		return NextResponse.json({ error: (error as Error).message }, { status: 500 })
	}
}
