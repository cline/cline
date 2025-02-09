/*
- class declarations
- interface declarations
- method declarations
- namespace declarations
- using declarations
*/

// Query for finding imports
export const importQuery = `
(using_directive name: (qualified_name) @module)
(using_directive (name_equals (identifier) @import) name: (qualified_name) @module)
`

// Query for finding definitions
export default `
(class_declaration
 name: (identifier) @name.definition.class
) @definition.class

(interface_declaration
 name: (identifier) @name.definition.interface
) @definition.interface

(method_declaration
 name: (identifier) @name.definition.method
) @definition.method

(namespace_declaration
 name: (identifier) @name.definition.module
) @definition.module
`
