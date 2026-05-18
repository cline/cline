import { expect } from "chai"
import proxyquire from "proxyquire"
import sinon from "sinon"

const loadNet = (tlsRejectUnauthorized?: string) => {
	const previousStandalone = process.env.IS_STANDALONE
	const previousTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED
	process.env.IS_STANDALONE = "true"
	if (tlsRejectUnauthorized === undefined) {
		delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
	} else {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = tlsRejectUnauthorized
	}

	const agentOptions: unknown[] = []
	class MockEnvHttpProxyAgent {
		constructor(options: unknown) {
			agentOptions.push(options)
		}
	}

	const setGlobalDispatcher = sinon.stub()
	const undiciFetch = sinon.stub()
	proxyquire.noCallThru().noPreserveCache()("../net", {
		undici: {
			EnvHttpProxyAgent: MockEnvHttpProxyAgent,
			setGlobalDispatcher,
			fetch: undiciFetch,
		},
		"@/services/EnvUtils": {
			buildExternalBasicHeaders: () => ({}),
		},
		openai: function MockOpenAI() {},
	})

	if (previousStandalone === undefined) {
		delete process.env.IS_STANDALONE
	} else {
		process.env.IS_STANDALONE = previousStandalone
	}
	if (previousTlsRejectUnauthorized === undefined) {
		delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
	} else {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsRejectUnauthorized
	}

	return { agentOptions, setGlobalDispatcher }
}

describe("shared net", function () {
	this.timeout(10_000)

	afterEach(() => {
		sinon.restore()
	})

	it("preserves default TLS verification for standalone fetch", () => {
		const { agentOptions, setGlobalDispatcher } = loadNet()

		expect(agentOptions).to.deep.equal([{}])
		expect(setGlobalDispatcher.calledOnce).to.equal(true)
	})

	it("passes the Node TLS opt-out through to standalone undici fetch", () => {
		const { agentOptions, setGlobalDispatcher } = loadNet("0")

		expect(agentOptions).to.deep.equal([
			{
				connect: {
					rejectUnauthorized: false,
				},
			},
		])
		expect(setGlobalDispatcher.calledOnce).to.equal(true)
	})
})
