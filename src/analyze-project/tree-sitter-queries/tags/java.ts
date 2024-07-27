/*
- class declarations
- method declarations
- interface declarations
- superclass references
*/
export default `
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(method_declaration
  name: (identifier) @name.definition.method) @definition.method

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

(superclass (type_identifier) @name.reference.class) @reference.class
`
