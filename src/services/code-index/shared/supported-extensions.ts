import { extensions as allExtensions } from "../../tree-sitter"

// Filter out markdown extensions for the scanner
export const scannerExtensions = allExtensions.filter((ext) => ext !== ".md" && ext !== ".markdown")
