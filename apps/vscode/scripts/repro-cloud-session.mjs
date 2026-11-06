const accessToken = process.env.CLINE_OAUTH_TOKEN?.trim()
if (!accessToken) {
	throw new Error("Set CLINE_OAUTH_TOKEN to a Cline OAuth access token.")
}

const apiBaseUrl = (process.env.CLINE_API_BASE_URL ?? "https://api.cline.bot").replace(/\/+$/, "")
const repositoryUrl = process.env.CLINE_REPO_URL ?? "https://github.com/cline/cline"
const branch = process.env.CLINE_BRANCH
const modelId = process.env.CLINE_MODEL_ID ?? "openai/gpt-5.6-sol"
const organizationId = process.env.CLINE_ORGANIZATION_ID

async function request(path, init = {}) {
	const response = await fetch(`${apiBaseUrl}${path}`, {
		...init,
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...init.headers,
		},
	})
	const body = response.status === 204 ? undefined : await response.json().catch(() => undefined)
	if (!response.ok) {
		throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`)
	}
	return body?.data
}

const created = await request("/api/v1/session", {
	method: "POST",
	body: JSON.stringify({
		modelId,
		repoUrl: repositoryUrl,
		...(branch ? { branch } : {}),
		...(organizationId ? { organizationId } : {}),
	}),
})
const sessionId = created?.sessionId
if (!sessionId) {
	throw new Error(`Create response had no session id: ${JSON.stringify(created)}`)
}

console.log(JSON.stringify({ event: "created", sessionId, created }))
try {
	const deadline = Date.now() + 10 * 60_000
	while (Date.now() < deadline) {
		const sessions = await request(
			`/api/v1/session${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`,
		)
		const record = sessions?.find((session) => session.id === sessionId)
		const status = await request(`/api/v1/session/${encodeURIComponent(sessionId)}/status`)
		console.log(
			JSON.stringify({
				event: "status",
				sessionId,
				sandboxId: record?.sandboxId,
				taskId: record?.metadata?.taskId,
				status,
			}),
		)
		if (["ready", "active", "failed"].includes(status?.status)) {
			break
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000))
	}
} finally {
	await request(`/api/v1/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch((error) => {
		console.error(`Cleanup failed for ${sessionId}:`, error)
	})
}
