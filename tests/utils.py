
def parse_multi_part_output(output_string, keys):
    """
    Parses a multi-part output string and returns a dictionary with specified keys.

    Args:
        output_string (str): The string containing the output data.
        keys (list): The list of keys to include in the final dictionary.

    Returns:
        dict: A dictionary with the specified keys and their corresponding float values.
    """
    # Ensure the output string is not empty
    if not output_string.strip():
        return {}

    # Initialize an empty dictionary to store the results
    result_dict = {}

    # Split the string into lines and iterate through them
    # .strip() is used to remove leading/trailing whitespace, including empty lines
    for line in output_string.strip().split('\n'):
        # Use a try-except block to handle potential errors if a line is not in the expected 'key: value' format
        try:
            # Split each line at the colon to separate the key and value
            key, value_str = line.split(':')

            # Clean up whitespace from both the key and value string
            key = key.strip()

            # Check if the cleaned key is in our list of keys to include
            if key in keys:
                # Convert the value string to a float and add it to the dictionary
                result_dict[key] = float(value_str.strip())

        except ValueError:
            # If the line cannot be split or the value cannot be converted,
            # we'll just skip this line and print an informational message.
            print(
                f"Warning: Skipping line due to unexpected format -> '{line}'")

    return result_dict


if __name__ == "__main__":
    output_string = """
    part1: 123.456
    part2: 789.012
    part3: 345.678
    """

    keys = ['part1', 'part2', 'part3']

    print(parse_multi_part_output(output_string, keys))
