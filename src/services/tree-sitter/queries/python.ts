/*
- class definitions
- function definitions
- method definitions (instance methods, class methods, static methods)
- decorators (function and class decorators)
- module-level variables
- constants (by convention, uppercase variables)
- async functions and methods
- lambda functions
- class attributes
- property getters/setters
- type annotations
- dataclasses
- nested functions and classes
- generator functions
- list/dict/set comprehensions
*/
export default `
; Class definitions
(class_definition
  name: (identifier) @name.definition.class) @definition.class

; Function definitions
(function_definition
  name: (identifier) @name.definition.function) @definition.function

; Method definitions (functions within a class)
(class_definition
  body: (block
    (function_definition
      name: (identifier) @name.definition.method))) @definition.method

; Individual method definitions (to capture all methods)
(class_definition
  body: (block
    (function_definition
      name: (identifier) @name.definition.method_direct))) @definition.method_direct

; Decorated functions and methods
(decorated_definition
  (decorator) @decorator
  definition: (function_definition
    name: (identifier) @name.definition.decorated_function)) @definition.decorated_function

; Decorated classes
(decorated_definition
  (decorator) @decorator
  definition: (class_definition
    name: (identifier) @name.definition.decorated_class)) @definition.decorated_class

; Module-level variables
(expression_statement
  (assignment
    left: (identifier) @name.definition.variable)) @definition.variable

; Constants (uppercase variables by convention)
(expression_statement
  (assignment
    left: (identifier) @name.definition.constant
    (#match? @name.definition.constant "^[A-Z][A-Z0-9_]*$"))) @definition.constant

; Async functions
(function_definition
  "async" @async
  name: (identifier) @name.definition.async_function) @definition.async_function

; Async methods
(class_definition
  body: (block
    (function_definition
      "async" @async
      name: (identifier) @name.definition.async_method))) @definition.async_method

; Lambda functions
(lambda
  parameters: (lambda_parameters) @parameters) @definition.lambda

; Class attributes
(class_definition
  body: (block
    (expression_statement
      (assignment
        left: (identifier) @name.definition.class_attribute)))) @definition.class_attribute

; Property getters/setters (using decorators)
(class_definition
  body: (block
    (decorated_definition
      (decorator
        (call
          function: (identifier) @property
          (#eq? @property "property")))
      definition: (function_definition
        name: (identifier) @name.definition.property_getter)))) @definition.property_getter

; Property setters
(class_definition
  body: (block
    (decorated_definition
      (decorator
        (attribute
          object: (identifier) @property
          attribute: (identifier) @setter
          (#eq? @property "property")
          (#eq? @setter "setter")))
      definition: (function_definition
        name: (identifier) @name.definition.property_setter)))) @definition.property_setter

; Type annotations for variables
(expression_statement
  (assignment
    left: (identifier) @name.definition.typed_variable
    type: (type))) @definition.typed_variable

; Type annotations for function parameters
(typed_parameter
  (identifier) @name.definition.typed_parameter) @definition.typed_parameter

; Direct type annotations for variables (in if __name__ == "__main__" block)
(assignment
  left: (identifier) @name.definition.direct_typed_variable
  type: (type)) @definition.direct_typed_variable

; Type annotations for functions with return type
(function_definition
  name: (identifier) @name.definition.typed_function
  return_type: (type)) @definition.typed_function

; Dataclasses (identified by decorator)
(decorated_definition
  (decorator
    (call
      function: (identifier) @dataclass
      (#eq? @dataclass "dataclass")))
  definition: (class_definition
    name: (identifier) @name.definition.dataclass)) @definition.dataclass

; Nested functions
(function_definition
  body: (block
    (function_definition
      name: (identifier) @name.definition.nested_function))) @definition.nested_function

; Nested classes
(function_definition
  body: (block
    (class_definition
      name: (identifier) @name.definition.nested_class))) @definition.nested_class

; Generator functions (identified by yield)
(function_definition
  name: (identifier) @name.definition.generator_function
  body: (block
    (expression_statement
      (yield)))) @definition.generator_function

; List comprehensions
(expression_statement
  (assignment
    right: (list_comprehension) @name.definition.list_comprehension)) @definition.list_comprehension

; Dictionary comprehensions
(expression_statement
  (assignment
    right: (dictionary_comprehension) @name.definition.dict_comprehension)) @definition.dict_comprehension

; Set comprehensions
(expression_statement
  (assignment
    right: (set_comprehension) @name.definition.set_comprehension)) @definition.set_comprehension

; Direct list comprehensions (in if __name__ == "__main__" block)
(list_comprehension) @definition.direct_list_comprehension

; Direct dictionary comprehensions (in if __name__ == "__main__" block)
(dictionary_comprehension) @definition.direct_dict_comprehension

; Direct set comprehensions (in if __name__ == "__main__" block)
(set_comprehension) @definition.direct_set_comprehension

; Class methods (identified by decorator)
(class_definition
  body: (block
    (decorated_definition
      (decorator
        (call
          function: (identifier) @classmethod
          (#eq? @classmethod "classmethod")))
      definition: (function_definition
        name: (identifier) @name.definition.class_method)))) @definition.class_method

; Static methods (identified by decorator)
(class_definition
  body: (block
    (decorated_definition
      (decorator
        (call
          function: (identifier) @staticmethod
          (#eq? @staticmethod "staticmethod")))
      definition: (function_definition
        name: (identifier) @name.definition.static_method)))) @definition.static_method
`
