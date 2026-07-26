// Under vitest, `@bedrock-coder/core` is aliased to src/test/bedrock-coder-core-vitest-stub.ts
// (see vitest.config.ts), which holds models.json state in memory and exposes
// the stub-only `resetModelsFileState` — hence the cast below.
import * as BedrockCoderCore from "@bedrock-coder/core"
import { beforeEach } from "vitest"

const { resetModelsFileState } = BedrockCoderCore as typeof BedrockCoderCore & { resetModelsFileState(): void }

beforeEach(() => {
	resetModelsFileState()
})
