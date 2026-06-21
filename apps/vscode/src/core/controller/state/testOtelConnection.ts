import { EmptyRequest } from "@shared/proto/cline/common"
import { TestConnectionResult } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function testOtelConnection(_controller: Controller, _: EmptyRequest): Promise<TestConnectionResult> {
	return TestConnectionResult.create({})
}
