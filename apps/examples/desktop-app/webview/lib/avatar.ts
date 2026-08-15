import { desktopClient } from "@/lib/desktop-client";

export const AVATAR_CHANGED_EVENT = "avatar-changed";
export const AVATAR_SHOWN_EVENT = "avatar-shown";

export type AvatarOption = {
	id: string;
	displayName: string;
	description: string;
};

export type SelectedAvatar = AvatarOption & {
	spriteUrl: string;
	enabled: boolean;
};

export function listAvatars(): Promise<AvatarOption[]> {
	return desktopClient.invoke<AvatarOption[]>("list_avatars");
}

export function getSelectedAvatar(): Promise<SelectedAvatar> {
	return desktopClient.invoke<SelectedAvatar>("get_selected_avatar");
}

export function selectAvatar(id: string): Promise<void> {
	return desktopClient.invoke("set_selected_avatar", { id });
}

export function setAvatarEnabled(enabled: boolean): Promise<void> {
	return desktopClient.invoke("set_avatar_enabled", { enabled });
}

export function performAvatarOverlayAction(
	action: "hide-avatar" | "open-cline",
): Promise<void> {
	return desktopClient.invoke("handle_avatar_overlay_action", { action });
}
