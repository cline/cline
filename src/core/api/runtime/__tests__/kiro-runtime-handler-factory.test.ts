import { describe, it } from "mocha"
import "should"
import { KiroCliHandler } from "../../providers/kiro-cli"
import { getRuntimeHandlerFactoryRegistry } from "../runtime-handler-factory-registry"

describe("KiroRuntimeHandlerFactory", () => {
	it("should expose the Kiro CLI runtime factory", () => {
		const registry = getRuntimeHandlerFactoryRegistry()
		const factory = registry.get("kiro-cli")

		should.exist(factory)

		const handler = factory!.buildHandler({
			mode: "act",
			configuration: {
				actModeApiProvider: "kiro-cli",
				planModeApiProvider: "kiro-cli",
				kiroCliPath: "/mock/kiro-cli",
			},
		})

		handler.should.be.instanceOf(KiroCliHandler)
	})
})
