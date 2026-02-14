import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs"
import * as assert from "assert"
import * as sinon from "sinon"
import type { ClineAccountUserInfo } from "@/services/auth/AuthService"
import * as distinctIdModule from "@/services/logging/distinctId"
import { OpenTelemetryTelemetryProvider } from "../OpenTelemetryTelemetryProvider"

/**
 * Helper to build a ClineAccountUserInfo with an active organization.
 */
function makeUserInfo(
	overrides: Partial<ClineAccountUserInfo> & { orgOverrides?: Record<string, unknown> } = {},
): ClineAccountUserInfo {
	const { orgOverrides, ...rest } = overrides
	return {
		id: "user-1",
		displayName: "Test User",
		email: "test@example.com",
		createdAt: new Date().toISOString(),
		organizations: [
			{
				active: true,
				memberId: "member-1",
				name: "Org A",
				organizationId: "org-a",
				roles: ["admin"],
				...(orgOverrides ?? {}),
			},
		],
		...rest,
	}
}

describe("OpenTelemetryTelemetryProvider.identifyUser", () => {
	let logExporter: InMemoryLogRecordExporter
	let loggerProvider: LoggerProvider
	let provider: OpenTelemetryTelemetryProvider
	let getDistinctIdStub: sinon.SinonStub
	let setDistinctIdStub: sinon.SinonStub

	beforeEach(() => {
		logExporter = new InMemoryLogRecordExporter()
		loggerProvider = new LoggerProvider()
		loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(logExporter))

		provider = new OpenTelemetryTelemetryProvider(null, loggerProvider, {
			name: "test-otel",
			bypassUserSettings: true,
		})

		getDistinctIdStub = sinon.stub(distinctIdModule, "getDistinctId")
		setDistinctIdStub = sinon.stub(distinctIdModule, "setDistinctId")
	})

	afterEach(() => {
		sinon.restore()
	})

	it("should emit user_identified log and update distinct ID when ID changes", () => {
		getDistinctIdStub.returns("machine-id-123")

		const userInfo = makeUserInfo()
		provider.identifyUser(userInfo)

		// Should have emitted user_identified
		const records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records.length, 1, "Should emit exactly one log record")
		assert.strictEqual(records[0].body, "user_identified")

		// Should include org attributes
		const attrs = records[0].attributes
		assert.strictEqual(attrs.user_id, "user-1")
		assert.strictEqual(attrs.organization_id, "org-a")
		assert.strictEqual(attrs.organization_name, "Org A")
		assert.strictEqual(attrs.member_id, "member-1")
		assert.strictEqual(attrs.member_roles, "admin")
		assert.strictEqual(attrs.alias, "machine-id-123")

		// Should update distinct ID
		assert.ok(setDistinctIdStub.calledOnceWith("user-1"), "Should call setDistinctId with user ID")
	})

	it("should refresh userAttributes even when distinct ID already matches (no new identify log)", () => {
		// Simulate: user already identified (distinct ID == user ID)
		getDistinctIdStub.returns("user-1")

		const userInfo = makeUserInfo()
		provider.identifyUser(userInfo)

		// Should NOT emit user_identified log
		const records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records.length, 0, "Should not emit identify log when distinct ID matches")

		// Should NOT call setDistinctId
		assert.ok(setDistinctIdStub.notCalled, "Should not call setDistinctId when ID already matches")

		// Now emit a regular log and verify org attributes are present
		provider.log("test_event", { custom: "value" })

		const logRecords = logExporter.getFinishedLogRecords()
		assert.strictEqual(logRecords.length, 1, "Should emit one log record for test_event")
		assert.strictEqual(logRecords[0].body, "test_event")

		const attrs = logRecords[0].attributes
		assert.strictEqual(attrs.organization_id, "org-a", "organization_id should be present in subsequent logs")
		assert.strictEqual(attrs.organization_name, "Org A", "organization_name should be present")
		assert.strictEqual(attrs.member_id, "member-1", "member_id should be present")
		assert.strictEqual(attrs.user_id, "user-1", "user_id should be present")
	})

	it("should refresh org attributes when active org changes (same user ID)", () => {
		// First identification with Org A
		getDistinctIdStub.returns("user-1")

		const userInfoOrgA = makeUserInfo()
		provider.identifyUser(userInfoOrgA)

		// Emit a log to capture Org A attributes
		provider.log("event_with_org_a")
		let records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records.length, 1)
		assert.strictEqual(records[0].attributes.organization_id, "org-a")
		assert.strictEqual(records[0].attributes.organization_name, "Org A")

		// Clear exporter for next assertion
		logExporter.reset()

		// Now switch to Org B (same user ID)
		const userInfoOrgB = makeUserInfo({
			orgOverrides: {
				organizationId: "org-b",
				name: "Org B",
				memberId: "member-2",
				roles: ["viewer", "editor"],
			},
		})
		provider.identifyUser(userInfoOrgB)

		// Should NOT emit user_identified (same user ID)
		records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records.length, 0, "Should not emit identify log on org switch with same user ID")

		// Emit a log and verify Org B attributes
		provider.log("event_with_org_b")
		records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records.length, 1)
		assert.strictEqual(records[0].attributes.organization_id, "org-b", "Should reflect new org ID")
		assert.strictEqual(records[0].attributes.organization_name, "Org B", "Should reflect new org name")
		assert.strictEqual(records[0].attributes.member_id, "member-2", "Should reflect new member ID")
		assert.strictEqual(records[0].attributes.member_roles, "viewer,editor", "Should reflect new roles")
	})

	it("should handle user with no active organization", () => {
		getDistinctIdStub.returns("user-1")

		const userInfo: ClineAccountUserInfo = {
			id: "user-1",
			displayName: "Solo User",
			email: "solo@example.com",
			createdAt: new Date().toISOString(),
			organizations: [],
		}
		provider.identifyUser(userInfo)

		// Emit a log and verify no org attributes leak from previous state
		provider.log("event_no_org")
		const records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records.length, 1)

		const attrs = records[0].attributes
		assert.strictEqual(attrs.user_id, "user-1")
		assert.strictEqual(attrs.user_name, "Solo User")
		assert.strictEqual(attrs.organization_id, undefined, "organization_id should not be present")
		assert.strictEqual(attrs.organization_name, undefined, "organization_name should not be present")
		assert.strictEqual(attrs.member_id, undefined, "member_id should not be present")
	})

	it("should clear stale org attributes when switching from org to no-org", () => {
		getDistinctIdStub.returns("user-1")

		// First: identify with an org
		provider.identifyUser(makeUserInfo())
		provider.log("with_org")
		let records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records[0].attributes.organization_id, "org-a")

		logExporter.reset()

		// Second: identify same user but no active org
		const userNoOrg: ClineAccountUserInfo = {
			id: "user-1",
			displayName: "Test User",
			email: "test@example.com",
			createdAt: new Date().toISOString(),
			organizations: [
				{
					active: false,
					memberId: "member-1",
					name: "Org A",
					organizationId: "org-a",
					roles: ["admin"],
				},
			],
		}
		provider.identifyUser(userNoOrg)

		provider.log("without_org")
		records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records.length, 1)
		assert.strictEqual(records[0].attributes.organization_id, undefined, "Stale org_id should be cleared")
		assert.strictEqual(records[0].attributes.organization_name, undefined, "Stale org_name should be cleared")
	})

	it("should include additional properties passed to identifyUser", () => {
		getDistinctIdStub.returns("machine-id")

		provider.identifyUser(makeUserInfo(), { extension_version: "1.2.3", custom_prop: "hello" })

		// Check the identify log includes the properties
		const records = logExporter.getFinishedLogRecords()
		assert.strictEqual(records.length, 1)
		assert.strictEqual(records[0].attributes.extension_version, "1.2.3")
		assert.strictEqual(records[0].attributes.custom_prop, "hello")
		assert.strictEqual(records[0].attributes.organization_id, "org-a")
	})
})
