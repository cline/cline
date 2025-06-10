import { StringRequest } from "@/shared/proto/common"
import { Uri } from "@/shared/proto/host/uri"
import { FileChangeEvent_ChangeType, SubscribeToFileRequest } from "@/shared/proto/host/watch"

const UriServiceClient = {
	parse: function (_: StringRequest): Uri {
		throw Error("Unimplemented")
	},
}
const WatchServiceClient = {
	subscribeToFile: function (
		_r: SubscribeToFileRequest,
		_h: {
			onResponse?: (response: { type: FileChangeEvent_ChangeType }) => void | Promise<void>
			onError?: (error: any) => void
			onComplete?: () => void
		},
	) {
		throw Error("Unimplemented")
	},
}

export { UriServiceClient, WatchServiceClient }
