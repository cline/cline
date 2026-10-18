import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: unknown;

	constructor(status: number, code: string, message: string, details?: unknown) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
	const response = NextResponse.json({ ok: true, data }, init);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

export function jsonError(status: number, code: string, message: string, details?: unknown) {
	const response = NextResponse.json(
		{ ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } },
		{ status },
	);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

export function handleApiError(error: unknown): NextResponse {
	if (error instanceof ApiError) {
		return jsonError(error.status, error.code, error.message, error.details);
	}

	if (error instanceof ZodError) {
		const first = error.issues[0];
		return jsonError(
			400,
			"validation_error",
			first ? `${first.path.join(".") || "request"}: ${first.message}` : "Invalid request",
			{ issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) },
		);
	}

	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("SUPABASE_SERVICE_ROLE_KEY is not configured")) {
		return jsonError(
			503,
			"server_not_configured",
			"The server is missing its Supabase service credentials.",
		);
	}
	if (message.includes("ENCRYPTION_KEY")) {
		return jsonError(
			503,
			"encryption_not_configured",
			"Server-side secret encryption is not configured.",
		);
	}

	console.error("[21-agent] Unhandled API error:", sanitizeLogMessage(message));
	return jsonError(500, "internal_error", "Something went wrong on our side. Please try again.");
}

export function sanitizeLogMessage(message: string): string {
	let out = message;
	// Never allow provider keys, JWTs or bearer tokens to reach logs.
	out = out.replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "sk-or-v1-[redacted]");
	out = out.replace(/dtn_[A-Za-z0-9]+/g, "dtn_[redacted]");
	out = out.replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[redacted-jwt]");
	out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
	return out.slice(0, 2000);
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
	}
	const result = schema.safeParse(body);
	if (!result.success) {
		const first = result.error.issues[0];
		throw new ApiError(
			400,
			"validation_error",
			first ? `${first.path.join(".") || "request"}: ${first.message}` : "Invalid request",
			result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
		);
	}
	return result.data;
}

export function getRequestMeta(request: Request): {
	ip: string;
	userAgent: string;
} {
	const forwarded = request.headers.get("x-forwarded-for");
	const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
	return {
		ip: ip.slice(0, 120),
		userAgent: (request.headers.get("user-agent") ?? "unknown").slice(0, 500),
	};
}

export function assert(
	condition: unknown,
	status: number,
	code: string,
	message: string,
): asserts condition {
	if (!condition) throw new ApiError(status, code, message);
}
