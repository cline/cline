/**
 * ExerciseLanguage
 */

export const exerciseLanguages = ["go", "java", "javascript", "python", "rust"] as const

export type ExerciseLanguage = (typeof exerciseLanguages)[number]

export const isExerciseLanguage = (value: string): value is ExerciseLanguage =>
	exerciseLanguages.includes(value as ExerciseLanguage)
