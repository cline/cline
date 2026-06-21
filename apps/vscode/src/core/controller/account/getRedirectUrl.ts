import { EmptyRequest, String } from "@shared/proto/cline/common"
import { Controller } from "../index"

export async function getRedirectUrl(_controller: Controller, _: EmptyRequest): Promise<String> {
	return String.create({})
}
