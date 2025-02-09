/*
- class declarations
- method declarations (including initializers and deinitializers)
- property declarations
- function declarations
*/

// Query for finding imports
export const importQuery = `
[
  (import_declaration
    path: (identifier) @module)

  (import_declaration
    path: (identifier) @module
    (import_list
      (identifier) @import))
]
`

// Query for finding definitions
export default `
(function_declaration
  name: (simple_identifier) @name.definition.function) @definition.function

(class_declaration
  name: (simple_identifier) @name.definition.class) @definition.class

(protocol_declaration
  name: (simple_identifier) @name.definition.class) @definition.class

(struct_declaration
  name: (simple_identifier) @name.definition.class) @definition.class
`
