/*
- function declarations (with associated comments)
- method declarations (with associated comments)
- type specifications
- type references
*/
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

(type_identifier) @name.reference.type @reference.type
`
