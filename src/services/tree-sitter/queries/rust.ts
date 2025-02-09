/*
- struct definitions
- method definitions
- function definitions
*/

// Query for finding imports
export const importQuery = `
[
  (use_declaration
    path: (scoped_identifier
      path: (identifier) @module
      name: (identifier) @import))

  (use_declaration
    path: (identifier) @module)

  (use_declaration
    path: (scoped_use_list
      path: (identifier) @module
      (use_list (identifier) @import)))
]
`

// Query for finding definitions
export default `
(function_item
  name: (identifier) @name.definition.function) @definition.function

(struct_item
  name: (type_identifier) @name.definition.class) @definition.class

(impl_item) @definition.class

(mod_item
  name: (identifier) @name.definition.module) @definition.module
`
