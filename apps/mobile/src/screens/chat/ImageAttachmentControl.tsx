import {
	DEFAULT_MAX_TOTAL_MEDIA_BYTES,
	validateImageMedia,
} from "@cline/shared";
import * as ImagePicker from "expo-image-picker";
import { Paperclip, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Keyboard, Pressable, ScrollView, View } from "react-native";
import { IconButton, Text, useTheme } from "@/ui";

const MAX_IMAGES = 4;
let attachmentSequence = 0;

export const ATTACHMENT_MESSAGE_REQUIRED =
	"Add a message describing what you want Cline to do with the attached images.";

export function getImageCapabilityError({
	hasImages,
	checkingImageSupport,
	supportsImages,
}: {
	hasImages: boolean;
	checkingImageSupport: boolean;
	supportsImages?: boolean;
}): string | undefined {
	if (!hasImages) return undefined;
	if (checkingImageSupport) return "Checking model image support…";
	if (supportsImages === false) {
		return "Choose a model that supports images or remove the attached images.";
	}
	return undefined;
}

export interface DraftImageAttachment {
	id: string;
	name: string;
	mediaType: string;
	base64: string;
}

/**
 * Owns the small, bounded image queue shared by the Home and chat composers.
 * ImagePicker's `base64` field is documented as JPEG bytes, so the wire payload
 * uses that media type even when the original library asset was HEIC.
 */
export function useImageAttachments(
	initialUserImages?: readonly string[],
	onImagesChange?: (userImages: string[]) => void,
) {
	const [images, setImages] = useState<DraftImageAttachment[]>([]);
	const imagesRef = useRef(images);
	imagesRef.current = images;
	const seededUserImages = useRef<readonly string[] | undefined>(undefined);
	const [error, setError] = useState<string>();
	const publish = useCallback(
		(next: readonly DraftImageAttachment[]) => {
			const userImages = next.map(
				(image) => `data:${image.mediaType};base64,${image.base64}`,
			);
			if (onImagesChange) {
				// Chat echoes this controlled value back as `initialUserImages`. Mark
				// it before publishing so that echo is not mistaken for a second seed.
				seededUserImages.current = userImages.length ? userImages : undefined;
				onImagesChange(userImages);
			}
		},
		[onImagesChange],
	);

	useEffect(() => {
		if (sameStrings(seededUserImages.current, initialUserImages)) {
			return;
		}
		const previousSeedPayloads = new Set(
			(seededUserImages.current ?? []).map((value) =>
				value.slice(value.indexOf(",") + 1),
			),
		);
		seededUserImages.current = initialUserImages;
		const parsed = (initialUserImages ?? [])
			.slice(0, MAX_IMAGES)
			.map(parseUserImage)
			.filter((image): image is DraftImageAttachment => image !== undefined);
		setImages((current) => {
			const locallyAdded = current.filter(
				(image) => !previousSeedPayloads.has(image.base64),
			);
			const next = [...locallyAdded, ...parsed].slice(0, MAX_IMAGES);
			imagesRef.current = next;
			return next;
		});
	}, [initialUserImages]);

	const pick = useCallback(async () => {
		Keyboard.dismiss();
		setError(undefined);
		const available = MAX_IMAGES - imagesRef.current.length;
		if (available <= 0) {
			setError(`You can attach up to ${MAX_IMAGES} images.`);
			return;
		}
		try {
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ["images"],
				allowsMultipleSelection: true,
				orderedSelection: true,
				selectionLimit: available,
				base64: true,
				quality: 0.7,
			});
			if (result.canceled) return;

			const next = [...imagesRef.current];
			let encodedTotal = next.reduce(
				(total, image) => total + image.base64.length,
				0,
			);
			let rejected = false;
			for (const asset of result.assets.slice(0, available)) {
				if (!asset.base64) {
					rejected = true;
					continue;
				}
				const validated = validateImageMedia("image/jpeg", asset.base64);
				if (
					!validated.ok ||
					encodedTotal + validated.encodedBytes > DEFAULT_MAX_TOTAL_MEDIA_BYTES
				) {
					rejected = true;
					continue;
				}
				encodedTotal += validated.encodedBytes;
				next.push({
					id: `mobile-image-${Date.now().toString(36)}-${(++attachmentSequence).toString(36)}`,
					name: asset.fileName?.trim() || `Image ${next.length + 1}`,
					mediaType: "image/jpeg",
					base64: validated.base64,
				});
			}
			imagesRef.current = next;
			setImages(next);
			publish(next);
			if (rejected) {
				setError(
					"Some images could not be attached or exceeded the 8 MB limit.",
				);
			}
		} catch {
			setError("Cline could not open your photo library. Try again.");
		}
	}, [publish]);

	const remove = useCallback(
		(id: string) => {
			const next = imagesRef.current.filter((image) => image.id !== id);
			imagesRef.current = next;
			setImages(next);
			publish(next);
			setError(undefined);
		},
		[publish],
	);
	const clear = useCallback(() => {
		imagesRef.current = [];
		setImages([]);
		publish([]);
		setError(undefined);
	}, [publish]);

	return { images, error, pick, remove, clear };
}

function sameStrings(
	left?: readonly string[],
	right?: readonly string[],
): boolean {
	if (left === right) return true;
	if (!left || !right || left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function parseUserImage(
	value: string,
	index: number,
): DraftImageAttachment | undefined {
	const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value);
	if (!match?.[1] || !match[2]) return undefined;
	const validated = validateImageMedia(match[1], match[2]);
	if (!validated.ok) return undefined;
	return {
		id: `mobile-staged-image-${Date.now().toString(36)}-${(++attachmentSequence).toString(36)}`,
		name: `Image ${index + 1}`,
		mediaType: validated.mediaType,
		base64: validated.base64,
	};
}

export function ImageAttachmentButton({
	onPress,
	disabled = false,
}: {
	onPress(): void;
	disabled?: boolean;
}) {
	const theme = useTheme();
	return (
		<IconButton
			accessibilityLabel="Attach images"
			disabled={disabled}
			onPress={onPress}
			padding={0}
		>
			<Paperclip size={16} color={theme.color.textMuted} />
		</IconButton>
	);
}

export function ImageAttachmentStrip({
	images,
	error,
	onRemove,
}: {
	images: readonly DraftImageAttachment[];
	error?: string;
	onRemove(id: string): void;
}) {
	const theme = useTheme();
	if (images.length === 0 && !error) return null;
	return (
		<View style={{ gap: 6, paddingTop: 8 }}>
			{images.length > 0 ? (
				<ScrollView
					horizontal
					keyboardShouldPersistTaps="handled"
					showsHorizontalScrollIndicator={false}
					contentContainerStyle={{ gap: 8 }}
				>
					{images.map((image) => (
						<View key={image.id} style={{ width: 64, height: 64 }}>
							<Image
								accessibilityLabel={image.name}
								source={{
									uri: `data:${image.mediaType};base64,${image.base64}`,
								}}
								style={{
									width: 64,
									height: 64,
									borderRadius: theme.radius.sm,
									backgroundColor: theme.color.surfaceMuted,
								}}
							/>
							<Pressable
								accessibilityLabel={`Remove ${image.name}`}
								accessibilityRole="button"
								hitSlop={8}
								onPress={() => onRemove(image.id)}
								style={{
									position: "absolute",
									top: 3,
									right: 3,
									width: 24,
									height: 24,
									borderRadius: 12,
									alignItems: "center",
									justifyContent: "center",
									backgroundColor: "rgba(0,0,0,0.72)",
								}}
							>
								<X size={14} color="#ffffff" />
							</Pressable>
						</View>
					))}
				</ScrollView>
			) : null}
			{error ? (
				<Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
					{error}
				</Text>
			) : null}
		</View>
	);
}
