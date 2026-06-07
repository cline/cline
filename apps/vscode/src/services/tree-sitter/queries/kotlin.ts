export default `
(class_declaration
  name: (simple_identifier) @name.definition.class) @definition.class

(function_declaration
  name: (simple_identifier) @name.definition.function) @definition.function

(interface_declaration
  name: (simple_identifier) @name.definition.interface) @definition.interface

(object_declaration
  name: (simple_identifier) @name.definition.object) @definition.object

(property_declaration
  name: (simple_identifier) @name.definition.property) @definition.property

(enum_declaration
  name: (simple_identifier) @name.definition.enum) @definition.enum

(typealias_declaration
  name: (simple_identifier) @name.definition.typealias) @definition.typealias
)`
