export const IMAGE = {
	type: "image",
	image: "data:image/png;base64,AAAA",
	mediaType: "image/png",
} as const;
export const RESUME =
	'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>';
export const ACT_APPROVAL =
	"The user approved switching to act mode. Continue with the approved plan now.";
export const MODE_NOTICE =
	"<mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>";
export const HOOK_BLOCK =
	'<hook_context source="RunStart">\nThe working tree has uncommitted changes.\n</hook_context>';
