/*
- class declarations (including interfaces)
- function declarations
- object declarations
- property declarations
- type alias declarations
*/
export default `
(class_declaration
  (type_identifier) @name.definition.class
) @definition.class

(function_declaration
  (simple_identifier) @name.definition.function
) @definition.function

(object_declaration
  (type_identifier) @name.definition.object
) @definition.object

(property_declaration
  (simple_identifier) @name.definition.property
) @definition.property

(type_alias
  (type_identifier) @name.definition.type
) @definition.type
`
