export type LatestSuccessfulRequestGate = {
	begin: () => number;
	commit: (requestId: number) => boolean;
	invalidate: () => void;
};

/**
 * Coordinates overlapping reads so failures do not invalidate a known-good
 * result. A successful read may commit unless a newer successful read or an
 * explicit invalidation has already advanced the commit watermark.
 */
export function createLatestSuccessfulRequestGate(): LatestSuccessfulRequestGate {
	let issuedRequestId = 0;
	let committedRequestId = 0;

	return {
		begin: () => {
			issuedRequestId += 1;
			return issuedRequestId;
		},
		commit: (requestId) => {
			if (requestId <= committedRequestId) {
				return false;
			}
			committedRequestId = requestId;
			return true;
		},
		invalidate: () => {
			issuedRequestId += 1;
			committedRequestId = issuedRequestId;
		},
	};
}
