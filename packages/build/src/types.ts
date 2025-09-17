import { z } from "zod"

const viewsContainerSchema = z.record(
	z.string(),
	z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			icon: z.string(),
		}),
	),
)

export type ViewsContainer = z.infer<typeof viewsContainerSchema>

const viewsSchema = z.record(
	z.string(),
	z.array(
		z.object({
			type: z.string(),
			id: z.string(),
			name: z.string(),
		}),
	),
)

export type Views = z.infer<typeof viewsSchema>

const commandsSchema = z.array(
	z.object({
		command: z.string(),
		title: z.string(),
		category: z.string().optional(),
		icon: z.string().optional(),
	}),
)

export type Commands = z.infer<typeof commandsSchema>

const menuItemSchema = z.object({
	group: z.string(),
	command: z.string().optional(),
	submenu: z.string().optional(),
	when: z.string().optional(),
})

export type MenuItem = z.infer<typeof menuItemSchema>

const menusSchema = z.record(z.string(), z.array(menuItemSchema))

export type Menus = z.infer<typeof menusSchema>

const submenusSchema = z.array(
	z.object({
		id: z.string(),
		label: z.string(),
	}),
)

export type Submenus = z.infer<typeof submenusSchema>

const keybindingsSchema = z.array(
	z.object({
		command: z.string(),
		key: z.string().optional(),
		mac: z.string().optional(),
		win: z.string().optional(),
		linux: z.string().optional(),
		when: z.string().optional(),
	}),
)

export type Keybindings = z.infer<typeof keybindingsSchema>

const configurationPropertySchema = z.object({
	type: z.union([
		z.literal("string"),
		z.literal("array"),
		z.literal("object"),
		z.literal("boolean"),
		z.literal("number"),
	]),
	items: z
		.object({
			type: z.string(),
		})
		.optional(),
	properties: z.record(z.string(), z.any()).optional(),
	default: z.any().optional(),
	description: z.string(),
})

export type ConfigurationProperty = z.infer<typeof configurationPropertySchema>

const configurationSchema = z.object({
	title: z.string(),
	properties: z.record(z.string(), configurationPropertySchema),
})

export type Configuration = z.infer<typeof configurationSchema>

export const contributesSchema = z.object({
	viewsContainers: viewsContainerSchema,
	views: viewsSchema,
	commands: commandsSchema,
	menus: menusSchema,
	submenus: submenusSchema,
	keybindings: keybindingsSchema.optional(),
	configuration: configurationSchema,
})

export type Contributes = z.infer<typeof contributesSchema>
