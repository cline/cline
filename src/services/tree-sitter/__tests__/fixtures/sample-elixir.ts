export default String.raw`
# Module attribute test - at least 4 lines long
@moduledoc """
This module demonstrates various Elixir
code structures for testing purposes
with tree-sitter parsing
"""

# Behaviour definition test - at least 4 lines long
defmodule TestBehaviourDefinition do
  @callback test_behaviour_callback(
    arg1 :: String.t(),
    arg2 :: integer()
  ) :: {:ok, any()} | {:error, String.t()}
end

# Module implementation test - at least 4 lines long
defmodule TestModuleDefinition do
  @behaviour TestBehaviourDefinition

  # Attribute test - at least 4 lines long
  @test_attribute_definition [
    key1: "value1",
    key2: "value2",
    key3: "value3"
  ]

  # Struct test - at least 4 lines long
  defstruct [
    field1: nil,
    field2: "",
    field3: 0,
    field4: %{}
  ]

  # Guard test - at least 4 lines long
  defguard test_guard_definition(value)
           when is_integer(value) and
                value > 0 and
                value < 100 and
                rem(value, 2) == 0

  # Macro test - at least 4 lines long
  defmacro test_macro_definition(opts) do
    quote do
      require Logger
      Logger.info("Macro called with: #{inspect(unquote(opts))}")
      unquote(opts)
    end
  end

  # Protocol implementation test - at least 4 lines long
  defimpl String.Chars,
    for: TestModuleDefinition do
    def to_string(%TestModuleDefinition{
      field1: f1,
      field2: f2
    }) do
      "TestModule(#{f1}, #{f2})"
    end
  end

  # Function with multiple clauses test - at least 4 lines long
  def test_function_definition(
    arg1,
    arg2 \\ nil,
    opts \\ []
  )

  def test_function_definition(
    arg1,
    nil,
    opts
  ) when is_list(opts) do
    {:ok, arg1}
  end

  # Pipeline operator test - at least 4 lines long
  def test_pipeline_definition(input) do
    input
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&(&1 != ""))
  end

  # List comprehension test - at least 4 lines long
  def test_comprehension_definition(list) do
    for item <- list,
        is_integer(item),
        item > 0,
        do: item * 2
  end

  # Sigil test - at least 4 lines long
  def test_sigil_definition do
    ~s"""
    This is a sigil
    that spans multiple
    lines for testing
    purposes
    """
  end
end

# Test module definition - at least 4 lines long
defmodule TestModuleDefinitionTest do
  use ExUnit.Case

  test "test_definition",
    %{
      field1: value1,
      field2: value2
    } do
    assert value1 == value2
  end
end
`
