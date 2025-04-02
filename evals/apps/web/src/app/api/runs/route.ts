import { NextResponse } from "next/server"

import { createRun } from "@evals/db"

export async function POST(request: Request) {
	try {
		const run = await createRun(await request.json())
		return NextResponse.json({ run }, { status: 201 })
	} catch (error) {
		return NextResponse.json({ error: (error as Error).message }, { status: 500 })
	}
}
