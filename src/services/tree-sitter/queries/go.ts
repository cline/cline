/*
- function declarations (with associated comments)
- method declarations (with associated comments)
- type specifications
*/

// Query for finding imports
export const importQuery = `
(import_declaration (import_spec name: (identifier) @import path: (interpreted_string_literal) @module))
`

export default `
(
  (comment)* @doc
  .
  (function_declaration
    name: (identifier) @name.definition.function) @definition.function
  (#strip! @doc "^//\\s*")
  (#set-adjacent! @doc @definition.function)
)

(
  (comment)* @doc
  .
  (method_declaration
    name: (field_identifier) @name.definition.method) @definition.method
  (#strip! @doc "^//\\s*")
  (#set-adjacent! @doc @definition.method)
)

  (type_spec
  name: (type_identifier) @name.definition.type) @definition.type
`
