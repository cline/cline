import { handleApiError, jsonOk } from "@/lib/api";
import { requireInternalSecret } from "@/lib/internal-auth";
import { runTick } from "../../../../../worker/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Operator-only queue tick. The production path is the long-lived worker
 * (`npm run worker`); this endpoint exists for manual recovery, smoke tests and
 * deployments that explicitly choose a bounded scheduled tick.
 */
export async function POST(request: Request) {
	try {
		requireInternalSecret(request);
		const workerId = request.headers.get("x-worker-id")?.slice(0, 80) ?? "http-tick";
		const result = await runTick(workerId, 120);
		return jsonOk(result);
	} catch (error) {
		return handleApiError(error);
	}
}
