import { NextResponse } from "next/server"

export async function GET() {
	try {
		return NextResponse.json(
			{
				status: "healthy",
				timestamp: new Date().toISOString(),
				uptime: process.uptime(),
				environment: process.env.NODE_ENV || "production",
			},
			{ status: 200 },
		)
	} catch (error) {
		return NextResponse.json(
			{
				status: "unhealthy",
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 503 },
		)
	}
}
