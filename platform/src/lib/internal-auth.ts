import { ApiError } from "@/lib/api";
import { constantTimeEqual } from "@/lib/crypto";

export function requireInternalSecret(request: Request): void {
	const expected = process.env.WORKER_INTERNAL_SECRET;
	if (!expected) {
		throw new ApiError(
			503,
			"internal_endpoint_disabled",
			"Internal endpoints are disabled because WORKER_INTERNAL_SECRET is not configured.",
		);
	}

	const authorization = request.headers.get("authorization");
	const bearer = authorization?.replace(/^Bearer\s+/i, "").trim();
	const header = request.headers.get("x-worker-secret")?.trim();
	const provided = bearer || header || "";

	if (!provided || !constantTimeEqual(provided, expected)) {
		throw new ApiError(401, "unauthorized", "Invalid internal credentials.");
	}
}
