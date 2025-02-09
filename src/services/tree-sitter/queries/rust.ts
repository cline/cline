/*
- struct definitions
- method definitions
- function definitions
*/

// Query for finding imports
export const importQuery = `
[
  ; Regular use declarations
  (use_declaration 
    path: (scoped_identifier 
      path: (identifier) @module
      name: (identifier) @import))

  ; Extern crate declarations
  (extern_crate_declaration 
    name: (identifier) @module)

  ; Use declarations with nested paths
  (use_declaration
    path: (scoped_use_list
      path: (identifier) @module
      (use_list (identifier) @import)))

  ; Self imports in use declarations
  (use_declaration
    path: (scoped_identifier
      path: (identifier) @module
      name: "self" @import))

  ; Glob imports
  (use_declaration
    path: (scoped_identifier
      path: (identifier) @module)
    (use_list_wildcard))
]
`

// Query for finding definitions
export default `
(struct_item
  name: (type_identifier) @name.definition.class) @definition.class

(declaration_list
    (function_item
        name: (identifier) @name.definition.method)) @definition.method

(function_item
    name: (identifier) @name.definition.function) @definition.function
`
