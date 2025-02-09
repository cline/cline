/*
- function declarations (with associated comments)
- method declarations (with associated comments)
- type specifications
*/

// Query for finding imports
export const importQuery = `
[
  (import_declaration
    (import_spec_list
      (import_spec
        path: (interpreted_string_literal) @module)))

  (import_declaration
    (import_spec_list
      (import_spec
        name: (package_identifier) @import
        path: (interpreted_string_literal) @module)))
]
`

export default `
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_declaration
  name: (field_identifier) @name.definition.method) @definition.method

(type_declaration
  (type_spec
    name: (type_identifier) @name.definition.class)) @definition.class
`
