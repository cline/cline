import { afterEach, beforeEach, describe, it } from "bun:test"
import { EnvServiceClientImpl } from "@generated/hosts/standalone/host-bridge-clients"
import * as niceGrpc from "@generated/nice-grpc/index"
import * as proto from "@shared/proto/index"
import { expect } from "chai"
import { createServer, type Server } from "nice-grpc"
import { captureHostBridgeTokenFromEnvironment, HOST_BRIDGE_TOKEN_HEADER } from "../host-bridge-auth"

type SeenCall = { method: string; token: string | undefined }

/**
 * End-to-end cover for the wiring the middleware unit tests cannot see: the
 * generator has to emit `createHostBridgeClient` into every generated client,
 * and that factory has to put the token on the wire. Asserting against a real
 * server means a regression in the generator template — or in the factory —
 * fails here instead of silently shipping unauthenticated calls.
 *
 * Tokens enter the way they do in production — set in the environment by the
 * host, then captured and scrubbed by the same bootstrap function cline-core
 * runs — so this also covers the startup-to-receiver path, not just the
 * middleware in isolation.
 *
 * EnvService stands in for all of them: the clients are generated from one
 * template, so the wiring is identical per service.
 */
describe("generated host bridge clients (end to end)", () => {
	const originalToken = process.env.CLINE_CORE_CONNECTION_TOKEN
	let server: Server
	let address: string
	let seen: SeenCall[]

	beforeEach(async () => {
		seen = []
		server = createServer()
		server.add(
			niceGrpc.host.EnvServiceDefinition,
			recordingEnvService((call) => seen.push(call)),
		)
		const port = await server.listen("127.0.0.1:0")
		address = `127.0.0.1:${port}`
	})

	afterEach(async () => {
		setToken(originalToken)
		await server.forceShutdown()
	})

	it("sends the spawn token on unary calls, after bootstrap scrubbed it from the environment", async () => {
		setToken("e2e-token")
		// The startup-to-receiver path: by the time any bridge call is made the
		// variable is gone, so the header can only come from the retained copy.
		expect(process.env.CLINE_CORE_CONNECTION_TOKEN).to.equal(undefined)

		await new EnvServiceClientImpl(address).getHostVersion(proto.cline.EmptyRequest.create({}))

		expect(seen).to.deep.equal([{ method: "getHostVersion", token: "e2e-token" }])
	})

	it("sends the spawn token on streaming calls", async () => {
		// Streaming calls pass their own call options (an abort signal), so this
		// also pins that the metadata survives that merge.
		setToken("e2e-token")
		const client = new EnvServiceClientImpl(address)

		await new Promise<void>((resolve, reject) => {
			client.subscribeToTelemetrySettings(proto.cline.EmptyRequest.create({}), {
				onResponse: () => resolve(),
				onError: reject,
			})
		})

		expect(seen[0]).to.deep.equal({ method: "subscribeToTelemetrySettings", token: "e2e-token" })
	})

	it("omits the header when the core was spawned without a token", async () => {
		setToken(undefined)

		await new EnvServiceClientImpl(address).getHostVersion(proto.cline.EmptyRequest.create({}))

		expect(seen).to.deep.equal([{ method: "getHostVersion", token: undefined }])
	})
})

/** The bootstrap step a spawned core runs: capture the host's token, scrub the environment. */
function setToken(token: string | undefined) {
	if (token === undefined) {
		delete process.env.CLINE_CORE_CONNECTION_TOKEN
	} else {
		process.env.CLINE_CORE_CONNECTION_TOKEN = token
	}
	captureHostBridgeTokenFromEnvironment()
}

/**
 * Implements every EnvService method from the service definition, recording the
 * token each call carried. Built from the definition rather than hand-listed so
 * new RPCs do not break this test.
 */
function recordingEnvService(record: (call: SeenCall) => void) {
	const implementation: Record<string, unknown> = {}
	for (const [method, definition] of Object.entries(niceGrpc.host.EnvServiceDefinition.methods)) {
		const observe = (context: { metadata: { get(key: string): string | undefined } }) =>
			record({ method, token: context.metadata.get(HOST_BRIDGE_TOKEN_HEADER) })

		implementation[method] = definition.responseStream
			? async function* (_request: unknown, context: any) {
					observe(context)
					yield {}
				}
			: async (_request: unknown, context: any) => {
					observe(context)
					return {}
				}
	}
	return implementation as any
}
