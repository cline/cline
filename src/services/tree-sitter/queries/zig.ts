export const zigQuery = `
; Functions
(function_declaration) @function.definition

; Structs and containers
(variable_declaration
  (identifier) @name
  (struct_declaration)
) @container.definition

; Enums
(variable_declaration
  (identifier) @name
  (enum_declaration)
) @container.definition

; Variables and constants
(variable_declaration
  (identifier) @name
) @variable.definition
`
