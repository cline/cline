import os

def list_files(directory='.', recursive=False, exclude=None):
    """
    List files in a directory, excluding certain directories.
    
    :param directory: Path to the directory to list files from (default is current directory)
    :param recursive: If True, lists files in all subdirectories
    :param exclude: List of directory names to exclude from the search
    :return: List of file paths
    """
    if exclude is None:
        exclude = ['node_modules', 'webview-ui', 'out','dist','coverage','__pycache__']
    
    file_list = []
    
    if recursive:
        for root, dirs, files in os.walk(directory):
            dirs[:] = [d for d in dirs if d not in exclude]
            for file in files:
                file_list.append(os.path.join(root, file))
    else:
        file_list = [os.path.join(directory, f) for f in os.listdir(directory) if os.path.isfile(os.path.join(directory, f)) and not os.path.dirname(os.path.join(directory, f)).split(os.sep)[-1] in exclude]
    
    return file_list

# Example usage
# List files in the current directory
# print(list_files())

# List files recursively in a specific directory
print(list_files('c:/dev/cline/src', recursive=True))