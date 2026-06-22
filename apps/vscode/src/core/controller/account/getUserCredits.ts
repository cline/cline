import { UserCreditsData } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function getUserCredits(_controller: Controller, _request: EmptyRequest): Promise<UserCreditsData> {
	return UserCreditsData.create({})
}
