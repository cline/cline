import { describe, it } from "bun:test"
import "should"
import { shouldStartNewOAuthFlow } from "../mcpOAuthFlow"

/**
 * `shouldStartNewOAuthFlow` decides whether `redirectToAuthorization()` starts a
 * new OAuth flow or keeps the one already in progress. A fresh in-progress flow
 * is kept so its stored `state` stays consistent with the authorization URL the
 * user is completing; a stale flow (older than the TTL, measured from when it
 * started) is replaced.
 */
describe("shouldStartNewOAuthFlow", () => {
	const TTL_MS = 10 * 60 * 1000

	it("starts a flow when none is in progress", () => {
		shouldStartNewOAuthFlow({ existingFlowStartedAt: undefined, now: 1000, ttlMs: TTL_MS }).should.be.true()
	})

	it("keeps a fresh in-progress flow instead of starting a new one", () => {
		shouldStartNewOAuthFlow({ existingFlowStartedAt: 1000, now: 2000, ttlMs: TTL_MS }).should.be.false()
	})

	it("starts a fresh flow when the existing one is stale (older than the TTL)", () => {
		shouldStartNewOAuthFlow({ existingFlowStartedAt: 1000, now: 1000 + TTL_MS + 1, ttlMs: TTL_MS }).should.be.true()
	})

	it("keeps the flow right up to the TTL boundary", () => {
		shouldStartNewOAuthFlow({ existingFlowStartedAt: 1000, now: 1000 + TTL_MS, ttlMs: TTL_MS }).should.be.false()
	})

	it("treats a missing start timestamp as no flow in progress", () => {
		shouldStartNewOAuthFlow({ existingFlowStartedAt: undefined, now: 5000, ttlMs: TTL_MS }).should.be.true()
	})
})
