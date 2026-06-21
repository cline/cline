import { StringRequest } from "@shared/proto/cline/common"
import { IsImageUrl } from "@shared/proto/cline/web"
import { Controller } from "../index"

export async function checkIsImageUrl(_: Controller, _request: StringRequest): Promise<IsImageUrl> {
	return IsImageUrl.create({})
}
