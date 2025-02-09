/*
- class declarations
- method declarations
- interface declarations
*/

// Query for finding imports
export const importQuery = `
[
  ; Regular imports
  (import_declaration
    name: (identifier) @import
    package: (string_literal) @module)
  
  ; Static imports
  (static_import_declaration
    type_name: (identifier) @module
    static_member: (identifier) @import)
  
  ; Wildcard imports
  (import_declaration
    name: (asterisk) @import
    package: (string_literal) @module)
  
  ; Static wildcard imports
  (static_import_declaration
    type_name: (identifier) @module
    static_member: (asterisk) @import)
]
`

// Query for finding definitions
export default `
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(method_declaration
  name: (identifier) @name.definition.method) @definition.method

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface
`
