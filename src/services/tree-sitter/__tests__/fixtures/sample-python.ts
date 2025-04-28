export const samplePythonContent = `
# NOTE: Some Python constructs are inherently single-line and exempt from the 4-line requirement:
# - Simple import statements
# - Global/nonlocal declarations
# - Simple variable declarations

# Class definition with decorators - demonstrates decorated class structure
@class_decorator_one
@class_decorator_two
class MultiLineDecoratedClass:
    """
    Class demonstrating multi-line structure with decorators
    and docstring spanning multiple lines for clarity
    """
    def __init__(self, value: int):
        self.value = value

# Method definition - demonstrates class method structure
class MethodContainer:
    """Class containing method definitions"""
    
    def multi_line_method(
        self,
        param1: str,
        param2: int,
        param3: list[str]
    ) -> str:
        """Method with multiple parameters and return type"""
        result = self._process(param1, param2)
        return f"{result}: {param3}"

# Async function with type annotations and decorators
@function_decorator_one
@function_decorator_two
async def multi_line_async_function(
    param1: str,
    param2: int,
    param3: list[str]
) -> None:
    """Async function demonstrating multiple decorators and type hints"""
    await async_operation_one(param1)
    result = await async_operation_two(param2)
    return await async_operation_three(result, param3)

# Generator function demonstrating yield
def multi_line_generator(
    start: int,
    end: int,
    step: int = 1
) -> int:
    """Generator function demonstrating yield across multiple lines"""
    current = start
    while current < end:
        yield current
        current += step

# Lambda with multiple lines using parentheses
multi_line_lambda = (
    lambda x, y, z:
    x * y + z
    if x > 0
    else z
)

# List comprehension across multiple lines
multi_line_comprehension = [
    x * y + z
    for x in range(10)
    for y in range(5)
    for z in range(3)
    if x % 2 == 0 and y % 2 == 0
]

# Complex with statement demonstrating context management
with (
    open('file1.txt', 'r', encoding='utf-8') as f1,
    open('file2.txt', 'r', encoding='utf-8') as f2,
    open('file3.txt', 'r', encoding='utf-8') as f3
):
    content1 = f1.read().strip()
    content2 = f2.read().strip()
    content3 = f3.read().strip()

# Try statement with multiple except blocks
try:
    result = complex_operation_one()
    intermediate = complex_operation_two(result)
    final = complex_operation_three(intermediate)
except ValueError as value_error:
    handle_value_error(value_error)
    log_error("ValueError occurred", value_error)
except TypeError as type_error:
    handle_type_error(type_error)
    log_error("TypeError occurred", type_error)
finally:
    cleanup_operations()
    log_completion()

# Multi-line import statement (4+ lines)
from typing import (
    List,
    Dict,
    Optional,
    Union,
    TypeVar
)

# Global and nonlocal statements (exempt from 4-line requirement)
def scope_demonstration():
    global global_var_one
    global global_var_two, global_var_three
    def inner_function():
        nonlocal outer_var_one
        nonlocal outer_var_two, outer_var_three
        outer_var_one = 1

# Match case statement (Python 3.10+)
def multi_line_pattern_match(value: dict):
    match value:
        case {
            "type": "user",
            "name": str() as name,
            "age": int() as age
        }:
            handle_user(name, age)
        case {
            "type": "group",
            "members": list() as members,
            "admin": str() as admin
        }:
            handle_group(members, admin)
        case _:
            handle_default()

# Complex type annotations
ComplexType = TypeVar('ComplexType')
multi_line_type_annotation: dict[
    str,
    Union[
        List[int],
        Dict[str, bool],
        Optional[ComplexType]
    ]
] = {}
`

export default {
	path: "test.py",
	content: samplePythonContent,
}
