import React, { createContext, useContext, useState, ReactNode } from "react"

interface EditedCommandContextType {
	editedCommand: string | null
	setEditedCommand: (command: string | null) => void
}

const EditedCommandContext = createContext<EditedCommandContextType | undefined>(undefined)

interface EditedCommandProviderProps {
	children: ReactNode
}

export const EditedCommandProvider: React.FC<EditedCommandProviderProps> = ({ children }) => {
	const [editedCommand, setEditedCommand] = useState<string | null>(null)

	return <EditedCommandContext.Provider value={{ editedCommand, setEditedCommand }}>{children}</EditedCommandContext.Provider>
}

export const useEditedCommand = () => {
	const context = useContext(EditedCommandContext)
	if (context === undefined) {
		throw new Error("useEditedCommand must be used within an EditedCommandProvider")
	}
	return context
}
