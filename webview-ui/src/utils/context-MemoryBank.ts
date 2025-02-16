export enum MemoryBankContextMenuOptionType {
	Initialize = "initialize",
	Update = "update",
	Follow = "follow",
}

export interface MemoryBankContextMenuQueryItem {
	type: MemoryBankContextMenuOptionType
}

export const memoryBankContextMenuOptions: MemoryBankContextMenuQueryItem[] = [
	{ type: MemoryBankContextMenuOptionType.Initialize },
	{ type: MemoryBankContextMenuOptionType.Update },
	{ type: MemoryBankContextMenuOptionType.Follow },
]
