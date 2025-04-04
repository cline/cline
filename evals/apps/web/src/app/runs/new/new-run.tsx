"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { useForm, FormProvider } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import fuzzysort from "fuzzysort"
import { toast } from "sonner"
import { X, Rocket, Check, ChevronsUpDown, HardDriveUpload, CircleCheck } from "lucide-react"

import { globalSettingsSchema, providerSettingsSchema, rooCodeDefaults } from "@evals/types"

import { createRun } from "@/lib/server/runs"
import { createRunSchema as formSchema, type CreateRun as FormValues } from "@/lib/schemas"
import { cn } from "@/lib/utils"
import { useOpenRouterModels } from "@/hooks/use-open-router-models"
import { useExercises } from "@/hooks/use-exercises"
import {
	Button,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormDescription,
	FormMessage,
	Textarea,
	Tabs,
	TabsList,
	TabsTrigger,
	MultiSelect,
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
	ScrollArea,
} from "@/components/ui"

import { SettingsDiff } from "./settings-diff"

const recommendedModels = [
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-3.7-sonnet:thinking",
	"google/gemini-2.0-flash-001",
]

export function NewRun() {
	const router = useRouter()

	const [modelSearchValue, setModelSearchValue] = useState("")
	const [modelPopoverOpen, setModelPopoverOpen] = useState(false)
	const modelSearchResultsRef = useRef<Map<string, number>>(new Map())
	const modelSearchValueRef = useRef("")
	const models = useOpenRouterModels()

	const exercises = useExercises()

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			model: "",
			description: "",
			suite: "full",
			exercises: [],
			settings: undefined,
		},
	})

	const {
		setValue,
		clearErrors,
		watch,
		formState: { isSubmitting },
	} = form

	const [model, suite, settings] = watch(["model", "suite", "settings"])

	const onSubmit = useCallback(
		async ({ settings, ...data }: FormValues) => {
			try {
				const openRouterModel = models.data?.find(({ id }) => id === data.model)

				if (!openRouterModel) {
					throw new Error(`Model not found: ${data.model}`)
				}

				const { id } = await createRun({
					...data,
					settings: {
						...settings,
						openRouterModelId: openRouterModel.id,
						openRouterModelInfo: openRouterModel.modelInfo,
					},
				})

				router.push(`/runs/${id}`)
			} catch (e) {
				toast.error(e instanceof Error ? e.message : "An unknown error occurred.")
			}
		},
		[router, models.data],
	)

	const onFilterModels = useCallback(
		(value: string, search: string) => {
			if (modelSearchValueRef.current !== search) {
				modelSearchValueRef.current = search
				modelSearchResultsRef.current.clear()

				for (const {
					obj: { id },
					score,
				} of fuzzysort.go(search, models.data || [], {
					key: "name",
				})) {
					modelSearchResultsRef.current.set(id, score)
				}
			}

			return modelSearchResultsRef.current.get(value) ?? 0
		},
		[models.data],
	)

	const onSelectModel = useCallback(
		(model: string) => {
			setValue("model", model)
			setModelPopoverOpen(false)
		},
		[setValue],
	)

	const onImportSettings = useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0]

			if (!file) {
				return
			}

			clearErrors("settings")

			try {
				const { providerProfiles, globalSettings } = z
					.object({
						providerProfiles: z.object({
							currentApiConfigName: z.string(),
							apiConfigs: z.record(z.string(), providerSettingsSchema),
						}),
						globalSettings: globalSettingsSchema,
					})
					.parse(JSON.parse(await file.text()))

				const providerSettings = providerProfiles.apiConfigs[providerProfiles.currentApiConfigName] ?? {}

				if (providerSettings.apiProvider === "openrouter" && providerSettings.openRouterModelId) {
					const {
						openRouterModelId,
						modelMaxTokens,
						modelMaxThinkingTokens,
						modelTemperature,
						includeMaxTokens,
					} = providerSettings

					const model = openRouterModelId

					const settings = {
						...rooCodeDefaults,
						openRouterModelId,
						modelMaxTokens,
						modelMaxThinkingTokens,
						modelTemperature,
						includeMaxTokens,
						...globalSettings,
					}

					setValue("model", model)
					setValue("settings", settings)
				} else {
					setValue("settings", globalSettings)
				}

				event.target.value = ""
			} catch (e) {
				toast.error(e instanceof Error ? e.message : "An unknown error occurred.")
			}
		},
		[clearErrors, setValue],
	)

	return (
		<>
			<FormProvider {...form}>
				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col justify-center divide-y divide-primary *:py-5">
					<FormField
						control={form.control}
						name="model"
						render={() => (
							<FormItem>
								<FormLabel>OpenRouter Model</FormLabel>
								<Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
									<PopoverTrigger asChild>
										<Button
											variant="input"
											role="combobox"
											aria-expanded={modelPopoverOpen}
											className="flex items-center justify-between">
											<div>
												{models.data?.find(({ id }) => id === model)?.name || model || "Select"}
											</div>
											<ChevronsUpDown className="opacity-50" />
										</Button>
									</PopoverTrigger>
									<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
										<Command filter={onFilterModels}>
											<CommandInput
												placeholder="Search"
												value={modelSearchValue}
												onValueChange={setModelSearchValue}
												className="h-9"
											/>
											<CommandList>
												<CommandEmpty>No model found.</CommandEmpty>
												<CommandGroup>
													{models.data?.map(({ id, name }) => (
														<CommandItem key={id} value={id} onSelect={onSelectModel}>
															{name}
															<Check
																className={cn(
																	"ml-auto text-accent group-data-[selected=true]:text-accent-foreground size-4",
																	id === model ? "opacity-100" : "opacity-0",
																)}
															/>
														</CommandItem>
													))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>
								<FormMessage />
								<FormDescription className="flex flex-wrap items-center gap-2">
									<span>Recommended:</span>
									{recommendedModels.map((modelId) => (
										<Button
											key={modelId}
											variant="link"
											className="break-all px-0!"
											onClick={(e) => {
												e.preventDefault()
												setValue("model", modelId)
											}}>
											{modelId}
										</Button>
									))}
								</FormDescription>
							</FormItem>
						)}
					/>

					<FormItem>
						<FormLabel>Import Settings</FormLabel>
						<Button
							type="button"
							variant="secondary"
							size="icon"
							onClick={() => document.getElementById("json-upload")?.click()}>
							<HardDriveUpload />
						</Button>
						<input
							id="json-upload"
							type="file"
							accept="application/json"
							className="hidden"
							onChange={onImportSettings}
						/>
						{settings ? (
							<ScrollArea className="max-h-64 border rounded-sm">
								<>
									<div className="flex items-center gap-1 p-2 border-b">
										<CircleCheck className="size-4 text-ring" />
										<div className="text-sm">
											Imported valid Roo Code settings. Showing differences from default settings.
										</div>
									</div>
									<SettingsDiff defaultSettings={rooCodeDefaults} customSettings={settings} />
								</>
							</ScrollArea>
						) : (
							<FormDescription>
								Fully configure how Roo Code for this run using a settings file that was exported by Roo
								Code.
							</FormDescription>
						)}
						<FormMessage />
					</FormItem>

					<FormField
						control={form.control}
						name="suite"
						render={() => (
							<FormItem>
								<FormLabel>Exercises</FormLabel>
								<Tabs
									defaultValue="full"
									onValueChange={(value) => setValue("suite", value as "full" | "partial")}>
									<TabsList>
										<TabsTrigger value="full">All</TabsTrigger>
										<TabsTrigger value="partial">Some</TabsTrigger>
									</TabsList>
								</Tabs>
								{suite === "partial" && (
									<MultiSelect
										options={exercises.data?.map((path) => ({ value: path, label: path })) || []}
										onValueChange={(value) => setValue("exercises", value)}
										placeholder="Select"
										variant="inverted"
										maxCount={4}
									/>
								)}
								<FormMessage />
							</FormItem>
						)}
					/>

					<FormField
						control={form.control}
						name="description"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Description / Notes</FormLabel>
								<FormControl>
									<Textarea placeholder="Optional" {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					<div className="flex justify-end">
						<Button size="lg" type="submit" disabled={isSubmitting}>
							<Rocket className="size-4" />
							Launch
						</Button>
					</div>
				</form>
			</FormProvider>
			<Button
				variant="default"
				className="absolute top-4 right-12 size-12 rounded-full"
				onClick={() => router.push("/")}>
				<X className="size-6" />
			</Button>
		</>
	)
}
