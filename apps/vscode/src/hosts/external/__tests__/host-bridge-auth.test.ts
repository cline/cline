import { afterEach, describe, it } from "bun:test"
import { expect } from "chai"
import { Metadata } from "nice-grpc"
import { HOST_BRIDGE_TOKEN_HEADER, hostBridgeAuthMiddleware, hostBridgeGrpcMetadata } from "../host-bridge-auth"

const originalToken = process.env.CLINE_CORE_CONNECTION_TOKEN

function setToken(token: string | undefined) {
	if (token === undefined) {
		delete process.env.CLINE_CORE_CONNECTION_TOKEN
	} else {
		process.env.CLINE_CORE_CONNECTION_TOKEN = token
	}
}

/** Drives the middleware and returns the options it passed downstream. */
async function runMiddleware(options: Record<string, unknown>): Promise<any> {
	let forwarded: any
	const call: any = {
		request: { some: "request" },
		requestStream: false,
		responseStream: false,
		// eslint-disable-next-line require-yield
		next: async function* (_request: unknown, nextOptions: unknown) {
			forwarded = nextOptions
			return "response"
		},
	}
	const iterator = (hostBridgeAuthMiddleware as any)(call, options)
	await iterator.next()
	return forwarded
}

describe("host bridge auth", () => {
	afterEach(() => setToken(originalToken))

	it("attaches the spawn token to outgoing calls", async () => {
		setToken("spawn-token-1")

		const forwarded = await runMiddleware({ metadata: Metadata() })

		expect(forwarded.metadata.get(HOST_BRIDGE_TOKEN_HEADER)).to.equal("spawn-token-1")
	})

	it("preserves caller-supplied metadata", async () => {
		setToken("spawn-token-1")

		const forwarded = await runMiddleware({ metadata: Metadata({ "x-existing": "kept" }) })

		expect(forwarded.metadata.get("x-existing")).to.equal("kept")
		expect(forwarded.metadata.get(HOST_BRIDGE_TOKEN_HEADER)).to.equal("spawn-token-1")
	})

	it("sends no header when the core was spawned without a token", async () => {
		setToken(undefined)

		const forwarded = await runMiddleware({ metadata: Metadata() })

		expect(forwarded.metadata.has(HOST_BRIDGE_TOKEN_HEADER)).to.equal(false)
	})

	it("reads the token at call time, not at import time", async () => {
		setToken("rotated-after-import")

		const forwarded = await runMiddleware({ metadata: Metadata() })

		expect(forwarded.metadata.get(HOST_BRIDGE_TOKEN_HEADER)).to.equal("rotated-after-import")
	})

	describe("grpc-js metadata", () => {
		it("carries the token for hand-written clients", () => {
			setToken("spawn-token-2")

			expect(hostBridgeGrpcMetadata().get(HOST_BRIDGE_TOKEN_HEADER)).to.deep.equal(["spawn-token-2"])
		})

		it("is empty without a token", () => {
			setToken(undefined)

			expect(hostBridgeGrpcMetadata().get(HOST_BRIDGE_TOKEN_HEADER)).to.deep.equal([])
		})
	})
})
