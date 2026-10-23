/** Cline provider/model control for the conversation composer. */

import {
	BottomSheetTextInput,
	type default as GorhomBottomSheet,
} from "@gorhom/bottom-sheet";
import { Check, ChevronRight, ChevronUp, Cpu, Lock } from "lucide-react-native";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { Pressable, View } from "react-native";
import type { CloudModelOption } from "@/cloud";
import {
	CLOUD_CATALOGS,
	type CloudCatalogId,
	cloudCatalogId,
	cloudProviderName,
} from "@/cloud/model-catalog";
import { userErrorMessage } from "@/error-message";
import {
	BottomSheet,
	Button,
	borderAlpha,
	Divider,
	fontFamily,
	Spinner,
	Text,
	useTheme,
} from "@/ui";
import { ComposerPill, usePillColors } from "./ComposerPill";

export const MODEL_UNAVAILABLE_MESSAGE =
	"Model selection is unavailable for this session.";

export interface ModelControlProps {
	cloud?: boolean;
	providerId?: string;
	modelId?: string;
	/** Reuse the catalog already fetched for composer capabilities. */
	cachedModels?: readonly CloudModelOption[];
	/** Every live ClineCore session can update unless its current turn is busy. */
	canChange: boolean;
	busy?: boolean;
	lockedMessage?: string;
	loadModels(): Promise<readonly CloudModelOption[]>;
	onChange(modelId: string, option?: CloudModelOption): Promise<void>;
}

function modelLabel(providerId?: string, modelId?: string): string {
	const rawProvider = providerId?.trim() || "cline";
	const provider =
		rawProvider === "cline" ? "Cline Usage-Billing" : rawProvider;
	const model = modelId?.trim();
	return model ? `${provider} · ${model}` : provider;
}

interface ModelSection {
	id: string;
	label?: string;
	description?: string;
	models: readonly CloudModelOption[];
}

/** Mirrors desktop's featured Cline picker without inventing tiers for local catalogs. */
export function buildModelSections(
	providerId: string | undefined,
	models: readonly CloudModelOption[],
): ModelSection[] {
	if (providerId !== "cline" || !models.some((model) => model.tier)) {
		return [{ id: "all", models }];
	}
	const recommended = models.filter((model) => model.tier === "recommended");
	const free = models.filter((model) => model.tier === "free");
	const subscribed = models.filter((model) => model.tier === "subscribed");
	const cloud = models.filter((model) => model.tier === "cloud");
	const all = models.filter(
		(model) =>
			model.tier !== "recommended" &&
			model.tier !== "free" &&
			model.tier !== "subscribed" &&
			model.tier !== "cloud",
	);
	return [
		{ id: "recommended", label: "Recommended", models: recommended },
		{ id: "cloud", label: "Cline Cloud", models: cloud },
		{
			id: "free",
			label: "Free",
			description: "Try with limited usage at no cost",
			models: free,
		},
		{
			id: "cline-pass",
			label: "Cline Pass",
			description: "Included with your Cline Pass subscription",
			models: subscribed,
		},
		{ id: "all", label: "All models", models: all },
	].filter((section) => section.models.length > 0);
}

export function ModelPill({
	providerId,
	modelId,
	cloud = false,
	modelName,
	compactLabel = false,
	onPress,
}: {
	providerId?: string;
	modelId?: string;
	cloud?: boolean;
	modelName?: string;
	compactLabel?: boolean;
	onPress(section?: "providers" | "models"): void;
}) {
	const colors = usePillColors("neutral");
	const label = modelLabel(providerId, modelId);
	if (compactLabel) {
		const shortLabel = modelName || modelId || "Choose model";
		return (
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Model: ${shortLabel}`}
				onPress={() => onPress("models")}
				style={{
					flex: 1,
					minWidth: 0,
					minHeight: 44,
					flexDirection: "row",
					alignItems: "center",
					gap: 4,
				}}
			>
				<Text
					variant="small"
					tone="muted"
					numberOfLines={1}
					style={{ flexShrink: 1 }}
				>
					{shortLabel}
				</Text>
				<ChevronUp size={12} color={colors.text} />
			</Pressable>
		);
	}
	if (cloud)
		return (
			<>
				<ComposerPill
					label={cloudProviderName(modelId)}
					trailing={<ChevronUp size={12} color={colors.text} />}
					accessibilityLabel={`Provider: ${cloudProviderName(modelId)}`}
					onPress={() => onPress("providers")}
				/>
				<ComposerPill
					label={modelName || modelId || "Choose model"}
					trailing={<ChevronUp size={12} color={colors.text} />}
					accessibilityLabel={`Model: ${modelName || modelId || "Choose model"}`}
					onPress={() => onPress("models")}
				/>
			</>
		);
	return (
		<ComposerPill
			compact
			label={label}
			tone="neutral"
			leading={<Cpu size={16} color={colors.text} />}
			trailing={<ChevronUp size={12} color={colors.text} />}
			accessibilityLabel={`Model: ${label}`}
			accessibilityHint="Opens model settings for this session"
			onPress={onPress}
		/>
	);
}

export function ModelSheet({
	providerId,
	modelId,
	cloud = false,
	initialSection = "models",
	cachedModels,
	canChange,
	busy = false,
	lockedMessage,
	loadModels,
	onChange,
	sheetRef: externalRef,
	settings,
}: ModelControlProps & {
	sheetRef?: RefObject<GorhomBottomSheet | null>;
	initialSection?: "providers" | "models";
	settings?: (dismiss: (then: () => void) => void) => ReactNode;
}) {
	const theme = useTheme();
	const internalRef = useRef<GorhomBottomSheet>(null);
	const sheetRef = externalRef ?? internalRef;
	const [loadedModels, setModels] = useState<readonly CloudModelOption[]>([]);
	const models = loadedModels.length
		? loadedModels
		: (cachedModels ?? loadedModels);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string>();
	const [savingId, setSavingId] = useState<string>();
	const [saveError, setSaveError] = useState<string>();
	const [query, setQuery] = useState("");
	const [section, setSection] = useState(initialSection);
	const openingSection = useRef(initialSection);
	openingSection.current = initialSection;
	useEffect(() => setSection(initialSection), [initialSection]);
	const [browsingCatalog, setBrowsingCatalog] = useState<CloudCatalogId>();
	const catalogId = browsingCatalog ?? cloudCatalogId(modelId, models);
	const catalogName = CLOUD_CATALOGS.find(
		(catalog) => catalog.id === catalogId,
	)!.name;
	const loadGeneration = useRef(0);
	const sheetOpen = useRef(false);
	const afterDismiss = useRef<(() => void) | undefined>(undefined);
	const dismissForSettings = (then: () => void) => {
		afterDismiss.current = then;
		sheetRef.current?.close();
	};
	const normalizedQuery = query.trim().toLowerCase();
	const filteredModels = models
		.filter(
			(model) =>
				!cloud || (model.catalogId ?? cloudCatalogId(model.id)) === catalogId,
		)
		.filter((model) =>
			[
				model.id,
				model.name,
				model.providerId,
				model.description,
				...model.tags,
			].some((value) => value?.toLowerCase().includes(normalizedQuery)),
		);
	const sections = cloud
		? [{ id: "catalog", models: filteredModels }]
		: buildModelSections(providerId, filteredModels);
	const optionKey = (model: CloudModelOption) =>
		JSON.stringify([model.providerId ?? providerId ?? "cline", model.id]);
	const isSelected = (model: CloudModelOption) =>
		model.id === modelId &&
		(model.providerId === undefined ||
			model.providerId === (providerId ?? "cline"));

	useEffect(() => {
		return () => {
			loadGeneration.current += 1;
			afterDismiss.current = undefined;
		};
	}, []);

	const reload = () => {
		if (!canChange) return;
		const generation = ++loadGeneration.current;
		setLoading(true);
		setLoadError(undefined);
		void loadModels().then(
			(next) => {
				if (generation !== loadGeneration.current) return;
				setModels(next);
				setLoading(false);
			},
			(error: unknown) => {
				if (generation !== loadGeneration.current) return;
				setLoadError(userErrorMessage(error, "Models could not be loaded."));
				setLoading(false);
			},
		);
	};

	const choose = async (model: CloudModelOption) => {
		if (busy || savingId || isSelected(model)) return;
		setSavingId(optionKey(model));
		setSaveError(undefined);
		try {
			await onChange(model.id, model);
			sheetRef.current?.close();
		} catch (error) {
			setSaveError(userErrorMessage(error, "The model could not be changed."));
		} finally {
			setSavingId(undefined);
		}
	};

	return (
		<BottomSheet
			ref={sheetRef}
			index={-1}
			// Loading, filtering, and provider navigation must not move the panel
			// beneath the user's finger. Only its contents change; they can scroll.
			enableDynamicSizing={false}
			snapPoints={["70%"]}
			scrollable
			enablePanDownToClose
			onChange={(index) => {
				const opening = index >= 0 && !sheetOpen.current;
				sheetOpen.current = index >= 0;
				if (index === -1) {
					const next = afterDismiss.current;
					afterDismiss.current = undefined;
					next?.();
				}
				// Keyboard/dynamic-size changes also emit onChange. Reloading there
				// unmounts the focused search input and drops the user's keyboard.
				if (opening) {
					// Native animations can retain the callback from before the tap
					// committed its provider/model choice. Read the current choice.
					setSection(openingSection.current);
					setBrowsingCatalog(undefined);
					setQuery("");
					reload();
				}
			}}
		>
			<View style={{ gap: 10 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Cpu size={16} color={theme.color.textMuted} />
					<Text variant="body" weight="500">
						{cloud && section === "providers" ? "Provider" : "Model"}
					</Text>
				</View>
				{!cloud ? (
					<Text variant="small" tone="muted">
						{modelLabel(providerId, modelId)}
					</Text>
				) : null}
				{settings ? (
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
						{settings(dismissForSettings)}
					</View>
				) : null}
				<Divider alpha={borderAlpha.strong} />

				{!canChange ? (
					<View style={{ gap: 8 }}>
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
						>
							<Lock size={14} color={theme.color.textMuted} />
							<Text variant="small" weight="500">
								Current session
							</Text>
						</View>
						<Text variant="small" tone="muted">
							{lockedMessage ??
								"Change this model from Cline on the connected computer."}
						</Text>
					</View>
				) : loading && models.length === 0 ? (
					<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						<Spinner size={14} />
						<Text variant="small" tone="muted">
							Loading Cline models…
						</Text>
					</View>
				) : loadError && models.length === 0 ? (
					<View style={{ gap: 8 }}>
						<Text variant="small" tone="danger">
							{loadError}
						</Text>
						<Button label="Try again" variant="outline" onPress={reload} />
					</View>
				) : cloud && section === "providers" ? (
					<View accessibilityRole="radiogroup" style={{ gap: 6 }}>
						{CLOUD_CATALOGS.map((catalog) => {
							const available = models.some(
								(model) =>
									(model.catalogId ?? cloudCatalogId(model.id)) === catalog.id,
							);
							return (
								<Pressable
									key={catalog.id}
									accessibilityRole="radio"
									accessibilityLabel={`Provider: ${catalog.name}`}
									accessibilityState={{
										checked: catalogId === catalog.id,
										disabled: busy || !available,
									}}
									disabled={busy || !available || Boolean(savingId)}
									onPress={() => {
										setBrowsingCatalog(catalog.id);
										setQuery("");
										setSection("models");
									}}
									style={{
										minHeight: 56,
										padding: 10,
										gap: 3,
										opacity: available ? 1 : 0.5,
										backgroundColor:
											catalogId === catalog.id
												? theme.color.surfaceMuted
												: "transparent",
										borderRadius: theme.radius.sm,
									}}
								>
									<Text variant="small" weight="500">
										{catalog.name}
										{catalogId === catalog.id ? " ✓" : ""}
									</Text>
									<Text variant="caption" tone="muted">
										{available
											? catalog.description
											: "No models currently available"}
									</Text>
								</Pressable>
							);
						})}
					</View>
				) : (
					<View style={{ gap: 10 }}>
						{cloud ? (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Choose provider"
								accessibilityValue={{ text: catalogName }}
								onPress={() => setSection("providers")}
								style={({ pressed }) => ({
									minHeight: 48,
									flexDirection: "row",
									alignItems: "center",
									gap: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									borderRadius: theme.radius.md,
									borderWidth: 1,
									borderColor: theme.color.borderStrong,
									backgroundColor: pressed
										? theme.color.surfaceMuted
										: theme.color.canvas,
								})}
							>
								<Text variant="small" tone="muted">
									Provider
								</Text>
								<Text
									variant="small"
									weight="500"
									style={{ flex: 1, textAlign: "right" }}
								>
									{catalogName}
								</Text>
								<ChevronRight size={16} color={theme.color.textMuted} />
							</Pressable>
						) : null}
						<BottomSheetTextInput
							keyboardAppearance={theme.mode}
							accessibilityLabel="Search models"
							placeholder="Search models…"
							value={query}
							onChangeText={setQuery}
							autoCorrect={false}
							autoCapitalize="none"
							placeholderTextColor={theme.color.textMuted}
							style={{
								minHeight: 44,
								paddingHorizontal: 12,
								paddingVertical: 10,
								color: theme.color.text,
								backgroundColor: theme.color.canvas,
								borderColor: theme.color.borderStrong,
								borderWidth: 1,
								borderRadius: theme.radius.md,
								fontSize: 16,
								fontFamily: fontFamily.sans,
							}}
						/>
						<View>
							<View accessibilityRole="radiogroup" style={{ gap: 14 }}>
								{sections.map((section) => (
									<View key={section.id} style={{ gap: 5 }}>
										{section.label ? (
											<View style={{ gap: 1, paddingHorizontal: 2 }}>
												<Text variant="small" weight="600">
													{section.label}
												</Text>
												{section.description ? (
													<Text variant="caption" tone="muted">
														{section.description}
													</Text>
												) : null}
											</View>
										) : null}
										{section.models.map((model) => {
											const selected = isSelected(model);
											const saving = savingId === optionKey(model);
											return (
												<Pressable
													key={optionKey(model)}
													accessibilityRole="radio"
													accessibilityLabel={`Use model ${model.name}${model.providerId ? ` from ${model.providerId}` : ""}`}
													accessibilityState={{
														checked: selected,
														disabled: busy,
													}}
													disabled={busy || Boolean(savingId)}
													onPress={() => void choose(model)}
													style={({ pressed }) => ({
														minHeight: 48,
														flexDirection: "row",
														alignItems: "center",
														gap: 8,
														paddingHorizontal: 10,
														paddingVertical: 7,
														borderWidth: 1,
														borderColor: selected
															? theme.brand.violetBorder
															: theme.color.border,
														borderRadius: theme.radius.sm,
														backgroundColor:
															pressed || selected
																? theme.color.surfaceMuted
																: "transparent",
														opacity: busy ? 0.55 : 1,
													})}
												>
													<View style={{ flex: 1, gap: 1 }}>
														<Text
															variant="small"
															weight="500"
															numberOfLines={1}
														>
															{model.name}
														</Text>
														<Text
															variant="caption"
															tone="muted"
															numberOfLines={2}
														>
															{model.providerId ? `${model.providerId} · ` : ""}
															{model.description?.trim() ||
																model.tags.join(" · ") ||
																model.id}
														</Text>
													</View>
													{model.tier === "free" ? (
														<Text variant="caption" tone="accent" weight="600">
															Free
														</Text>
													) : model.tier === "recommended" && model.tags[0] ? (
														<Text variant="caption" tone="accent" weight="600">
															{model.tags[0]}
														</Text>
													) : null}
													{saving ? (
														<Spinner size={14} />
													) : selected ? (
														<Check size={15} color={theme.brand.violet} />
													) : null}
												</Pressable>
											);
										})}
									</View>
								))}
							</View>
							{sections.every((section) => section.models.length === 0) ? (
								<Text variant="small" tone="muted">
									No models match your search.
								</Text>
							) : null}
						</View>
					</View>
				)}

				{loadError && models.length > 0 ? (
					<View style={{ gap: 8 }}>
						<Text variant="small" tone="muted">
							Could not refresh models. Showing the last loaded list.
						</Text>
						<Button label="Try again" variant="outline" onPress={reload} />
					</View>
				) : null}
				{busy && canChange ? (
					<Text variant="caption" tone="muted">
						Wait for the current turn to finish before changing model.
					</Text>
				) : null}
				{saveError ? (
					<Text variant="small" tone="danger">
						{saveError}
					</Text>
				) : null}
				<View style={{ height: 6 }} />
			</View>
		</BottomSheet>
	);
}

export function ModelControl(props: ModelControlProps) {
	const sheetRef = useRef<GorhomBottomSheet>(null);
	const [initialSection, setInitialSection] = useState<"providers" | "models">(
		"models",
	);
	return (
		<>
			<ModelPill
				providerId={props.providerId}
				modelId={props.modelId}
				cloud={props.cloud}
				onPress={(section = "models") => {
					setInitialSection(section);
					sheetRef.current?.expand();
				}}
			/>
			<ModelSheet
				{...props}
				initialSection={initialSection}
				sheetRef={sheetRef}
			/>
		</>
	);
}
