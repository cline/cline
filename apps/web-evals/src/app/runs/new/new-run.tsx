"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { useForm, FormProvider } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import fuzzysort from "fuzzysort"
import { toast } from "sonner"
import { X, Rocket, Check, ChevronsUpDown, SlidersHorizontal, Book, CircleCheck } from "lucide-react"

import { globalSettingsSchema, providerSettingsSchema, EVALS_SETTINGS, getModelId } from "@roo-code/types"

import { createRun } from "@/actions/runs"
import { getExercises } from "@/actions/exercises"
import {
	createRunSchema,
	type CreateRun,
	MODEL_DEFAULT,
	CONCURRENCY_MIN,
	CONCURRENCY_MAX,
	CONCURRENCY_DEFAULT,
} from "@/lib/schemas"
import { cn } from "@/lib/utils"
import { useOpenRouterModels } from "@/hooks/use-open-router-models"
import {
	Button,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
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
	Slider,
	Dialog,
	DialogContent,
	DialogTitle,
	DialogFooter,
} from "@/components/ui"

import { SettingsDiff } from "./settings-diff"

export function NewRun() {
	const router = useRouter()

	const [mode, setMode] = useState<"openrouter" | "settings">("openrouter")
	const [modelSearchValue, setModelSearchValue] = useState("")
	const [modelPopoverOpen, setModelPopoverOpen] = useState(false)

	const modelSearchResultsRef = useRef<Map<string, number>>(new Map())
	const modelSearchValueRef = useRef("")

	const models = useOpenRouterModels()
	const exercises = useQuery({ queryKey: ["getExercises"], queryFn: () => getExercises() })

	const form = useForm<CreateRun>({
		resolver: zodResolver(createRunSchema),
		defaultValues: {
			model: MODEL_DEFAULT,
			description: "",
			suite: "full",
			exercises: [],
			settings: undefined,
			concurrency: CONCURRENCY_DEFAULT,
		},
	})

	const {
		setValue,
		clearErrors,
		watch,
		formState: { isSubmitting },
	} = form

	const [model, suite, settings] = watch(["model", "suite", "settings", "concurrency"])

	const [systemPromptDialogOpen, setSystemPromptDialogOpen] = useState(false)
	const [systemPrompt, setSystemPrompt] = useState("")
	const systemPromptRef = useRef<HTMLTextAreaElement>(null)

	const onSubmit = useCallback(
		async (values: CreateRun) => {
			try {
				if (mode === "openrouter") {
					values.settings = { ...(values.settings || {}), openRouterModelId: model }
				}

				const { id } = await createRun({ ...values, systemPrompt })
				router.push(`/runs/${id}`)
			} catch (e) {
				toast.error(e instanceof Error ? e.message : "An unknown error occurred.")
			}
		},
		[mode, model, router, systemPrompt],
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

				setValue("model", getModelId(providerSettings) ?? "")
				setValue("settings", { ...EVALS_SETTINGS, ...providerSettings, ...globalSettings })
				setMode("settings")

				event.target.value = ""
			} catch (e) {
				console.error(e)
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
					<div className="flex flex-row justify-between gap-4">
						{mode === "openrouter" && (
							<FormField
								control={form.control}
								name="model"
								render={() => (
									<FormItem className="flex-1">
										<Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
											<PopoverTrigger asChild>
												<Button
													variant="input"
													role="combobox"
													aria-expanded={modelPopoverOpen}
													className="flex items-center justify-between">
													<div>
														{models.data?.find(({ id }) => id === model)?.name ||
															model ||
															"Select OpenRouter Model"}
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
																<CommandItem
																	key={id}
																	value={id}
																	onSelect={onSelectModel}>
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
									</FormItem>
								)}
							/>
						)}

						<FormItem className="flex-1">
							<Button
								type="button"
								variant="secondary"
								onClick={() => document.getElementById("json-upload")?.click()}>
								<SlidersHorizontal />
								Import Settings
							</Button>
							<input
								id="json-upload"
								type="file"
								accept="application/json"
								className="hidden"
								onChange={onImportSettings}
							/>
							{settings && (
								<ScrollArea className="max-h-64 border rounded-sm">
									<>
										<div className="flex items-center gap-1 p-2 border-b">
											<CircleCheck className="size-4 text-ring" />
											<div className="text-sm">
												Imported valid Roo Code settings. Showing differences from default
												settings.
											</div>
										</div>
										<SettingsDiff defaultSettings={EVALS_SETTINGS} customSettings={settings} />
									</>
								</ScrollArea>
							)}
							<FormMessage />
						</FormItem>

						<Button type="button" variant="secondary" onClick={() => setSystemPromptDialogOpen(true)}>
							<Book />
							Override System Prompt
						</Button>

						<Dialog open={systemPromptDialogOpen} onOpenChange={setSystemPromptDialogOpen}>
							<DialogContent>
								<DialogTitle>Override System Prompt</DialogTitle>
								<Textarea
									ref={systemPromptRef}
									value={systemPrompt}
									onChange={(e) => setSystemPrompt(e.target.value)}
								/>
								<DialogFooter>
									<Button onClick={() => setSystemPromptDialogOpen(false)}>Done</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</div>

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
						name="concurrency"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Concurrency</FormLabel>
								<FormControl>
									<div className="flex flex-row items-center gap-2">
										<Slider
											defaultValue={[field.value]}
											min={CONCURRENCY_MIN}
											max={CONCURRENCY_MAX}
											step={1}
											onValueChange={(value) => field.onChange(value[0])}
										/>
										<div>{field.value}</div>
									</div>
								</FormControl>
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
