import { useEffect, useState } from "react";
import type { CliCloudRuntime } from "../../runtime/cloud/runtime";

export function useCloudState(runtime?: CliCloudRuntime) {
	const [state, setState] = useState(() => runtime?.getSnapshot());
	useEffect(() => {
		setState(runtime?.getSnapshot());
		if (!runtime) return;
		return runtime.subscribe(() => setState(runtime.getSnapshot()));
	}, [runtime]);
	return state;
}
