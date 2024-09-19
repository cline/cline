export default `
(
  (class_definition
    name: (identifier) @class.name
  ) @class.definition

  (mixin_declaration
    name: (identifier) @mixin.name
  ) @mixin.definition

  (enum_declaration
    name: (identifier) @enum.name
  ) @enum.definition

  (function_signature
    name: (identifier) @function.name
  ) @function.definition

  (method_signature
    name: (identifier) @method.name
  ) @method.definition

  (getter_signature
    name: (identifier) @getter.name
  ) @getter.definition

  (setter_signature
    name: (identifier) @setter.name
  ) @setter.definition

  (constructor_signature
    name: (identifier) @constructor.name
  ) @constructor.definition

  (top_level_variable_declaration
    (initialized_variable_definition
      name: (identifier) @variable.name
    )
  ) @variable.definition
)
`
