import { useQuery } from "@tanstack/react-query"

import { getExercises } from "@/lib/server/exercises"

export const useExercises = () => useQuery({ queryKey: ["exercises"], queryFn: getExercises })
