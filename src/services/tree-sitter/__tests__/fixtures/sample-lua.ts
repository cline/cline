export default String.raw`
-- Function declaration test - at least 4 lines long
function test_function(
    arg1,
    arg2,
    arg3
)
    print("This is a test function")
    return arg1 + arg2 + arg3
end

-- Local function declaration test - at least 4 lines long
local function test_local_function(
    param1,
    param2,
    param3
)
    local result = param1 * param2 * param3
    print("Local function result:", result)
    return result
end

-- Table with method declaration test - at least 4 lines long
local test_table_with_methods = {
    data = "test data",
    
    test_method = function(
        self,
        param
    )
        print("Method called with:", param)
        return self.data .. " " .. param
    end
}

-- Table declaration test - at least 4 lines long
local test_table = {
    name = "test table",
    value = 42,
    nested = {
        key = "nested value"
    }
}

-- Array table declaration test - at least 4 lines long
local test_array_table = {
    "first",
    "second",
    "third",
    "fourth"
}

-- If statement test - at least 4 lines long
local test_if_statement_var = 10
if test_if_statement_var > 5 then
    print("Greater than 5")
    test_if_statement_var = test_if_statement_var + 1
elseif test_if_statement_var < 5 then
    print("Less than 5")
    test_if_statement_var = test_if_statement_var - 1
else
    print("Equal to 5")
    test_if_statement_var = 5
end

-- Numeric for loop test - at least 4 lines long
for test_for_loop_index = 1, 10, 2 do
    print("Loop index:", test_for_loop_index)
    if test_for_loop_index > 5 then
        print("More than halfway")
    end
end

-- Generic for loop with pairs - at least 4 lines long
for test_for_in_loop_key, test_for_in_loop_value in pairs(test_table) do
    print(
        "Key:", test_for_in_loop_key,
        "Value:", test_for_in_loop_value
    )
end

-- While loop test - at least 4 lines long
local test_while_loop_counter = 0
while test_while_loop_counter < 5 do
    print("Counter:", test_while_loop_counter)
    test_while_loop_counter = test_while_loop_counter + 1
    if test_while_loop_counter == 3 then
        print("Halfway there")
    end
end

-- Repeat until loop test - at least 4 lines long
local test_repeat_until_counter = 10
repeat
    print("Counting down:", test_repeat_until_counter)
    test_repeat_until_counter = test_repeat_until_counter - 1
    if test_repeat_until_counter == 5 then
        print("Halfway there")
    end
until test_repeat_until_counter == 0

-- Do block test - at least 4 lines long
do
    local test_do_block_var = "local to do block"
    print("Inside do block")
    print("Using local var:", test_do_block_var)
    test_function(1, 2, 3)
end

-- Variable declaration test - at least 4 lines long
test_variable_declaration = 
    "This is a global variable" ..
    " with a long string" ..
    " split across multiple lines"

-- Local variable declaration test - at least 4 lines long
local test_local_variable = 
    "This is a local variable" ..
    " with a long string" ..
    " split across multiple lines"

-- Require statement - cannot be 4 lines naturally, but important to test
local test_require = require("module_name")

-- Module definition - at least 4 lines long
local test_module = {}

function test_module.test_module_function(
    arg1,
    arg2
)
    return arg1 + arg2
end

test_module.test_module_variable = "module variable"

return test_module
`
