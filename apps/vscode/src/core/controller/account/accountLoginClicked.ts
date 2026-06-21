import { EmptyRequest, String } from "@shared/proto/cline/common"
import { Controller } from "../index"

export async function accountLoginClicked(_controller: Controller, _: EmptyRequest): Promise<String> {
	return String.create({})
}
