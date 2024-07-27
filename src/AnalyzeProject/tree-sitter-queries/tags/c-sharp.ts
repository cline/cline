/*
- class declarations
- interface declarations
- method declarations
- namespace declarations
*/
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
