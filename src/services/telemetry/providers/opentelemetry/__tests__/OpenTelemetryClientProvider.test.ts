import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import * as assert from "assert"
import { createOpenTelemetryResource } from "../OpenTelemetryClientProvider"

describe("OpenTelemetryClientProvider", () => {
	it("adds configured resource attributes without overriding Cline service identity", () => {
		const resource = createOpenTelemetryResource({
			resourceAttributes: {
				username: "john",
				team: "platform",
				[ATTR_SERVICE_NAME]: "custom-service",
			},
		})

		assert.strictEqual(resource.attributes.username, "john")
		assert.strictEqual(resource.attributes.team, "platform")
		assert.strictEqual(resource.attributes[ATTR_SERVICE_NAME], "cline")
		assert.ok(resource.attributes[ATTR_SERVICE_VERSION])
	})
})
