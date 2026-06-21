import { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function ocaAccountLoginClicked(_controller: Controller, _: EmptyRequest): Promise<ProtoString> {
	return ProtoString.create({})
}
