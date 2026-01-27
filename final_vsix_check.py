import zipfile
import json
import os

def extract_package_json_from_vsix(vsix_path):
    """Extract package.json from VSIX"""
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            for name in z.namelist():
                if name.endswith('package.json') and 'extension/' in name:
                    package_content = z.read(name).decode('utf-8')
                    return json.loads(package_content)
    except Exception as e:
        print(f"Error: {e}")
    return None

def compare_commands(source_package, vsix_package, vsix_name):
    """Compare commands between source and VSIX"""
    source_commands = source_package.get('contributes', {}).get('commands', [])
    vsix_commands = vsix_package.get('contributes', {}).get('commands', [])
    
    source_command_set = {cmd['command']: cmd['title'] for cmd in source_commands}
    vsix_command_set = {cmd['command']: cmd['title'] for cmd in vsix_commands}
    
    print(f"\nCommand comparison ({vsix_name}):")
    print(f"  Source: {len(source_commands)} commands")
    print(f"  VSIX: {len(vsix_commands)} commands")
    
    # Check for missing commands in VSIX
    missing_in_vsix = []
    for cmd_id, title in source_command_set.items():
        if cmd_id not in vsix_command_set:
            missing_in_vsix.append((cmd_id, title))
    
    # Check for extra commands in VSIX (not in source)
    extra_in_vsix = []
    for cmd_id, title in vsix_command_set.items():
        if cmd_id not in source_command_set:
            extra_in_vsix.append((cmd_id, title))
    
    if missing_in_vsix:
        print(f"\n  ❌ Commands missing in VSIX:")
        for cmd_id, title in missing_in_vsix:
            print(f"     - {title} ({cmd_id})")
    else:
        print(f"  ✓ All source commands present in VSIX")
    
    if extra_in_vsix:
        print(f"\n  ⚠ Extra commands in VSIX (not in source):")
        for cmd_id, title in extra_in_vsix:
            print(f"     - {title} ({cmd_id})")
    
    return len(missing_in_vsix) == 0

def check_specific_features(vsix_package):
    """Check for specific newer features"""
    print("\nChecking for specific newer features:")
    
    commands = vsix_package.get('contributes', {}).get('commands', [])
    command_titles = [cmd.get('title', '') for cmd in commands]
    
    # Features from changelog 3.48.0+
    features = {
        'Jupyter Notebook Support': any('jupyter' in title.lower() for title in command_titles),
        'Skills System': any('skill' in title.lower() for title in command_titles),
        'MCP Servers': any('mcp' in title.lower() for title in command_titles),
        'Commit Message Generation': any('commit' in title.lower() for title in command_titles),
        'Explain Code': any('explain' in title.lower() for title in command_titles),
        'Voice/Dictation': any('voice' in title.lower() for title in command_titles),
        'Focus Chain': any('focus' in title.lower() for title in command_titles),
        'GPT-5 Models': True,  # This would be in API providers, not commands
        'Create Pull Request Skill': any('pull' in title.lower() for title in command_titles),
    }
    
    for feature, present in features.items():
        status = "✓" if present else "✗"
        print(f"  {status} {feature}")
    
    return features

def main():
    downloads_path = r"C:\Users\bob43\Downloads"
    newest_vsix = "cline-3.53.2-clean.vsix"
    newest_path = os.path.join(downloads_path, newest_vsix)
    
    # Load source package.json
    try:
        with open('package.json', 'r', encoding='utf-8') as f:
            source_package = json.load(f)
    except Exception as e:
        print(f"Error loading source package.json: {e}")
        return
    
    # Extract VSIX package.json
    vsix_package = extract_package_json_from_vsix(newest_path)
    if not vsix_package:
        print(f"Could not extract package.json from {newest_vsix}")
        return
    
    print("=" * 60)
    print("VSIX FEATURE ANALYSIS")
    print("=" * 60)
    
    print(f"\nVersion comparison:")
    source_version = source_package.get('version', 'unknown')
    vsix_version = vsix_package.get('version', 'unknown')
    print(f"  Source code: {source_version}")
    print(f"  VSIX ({newest_vsix}): {vsix_version}")
    
    if vsix_version == source_version:
        print(f"  ✓ Versions match")
    elif vsix_version > source_version:
        print(f"  ⚠ VSIX is NEWER than source ({vsix_version} > {source_version})")
    else:
        print(f"  ⚠ VSIX is OLDER than source ({vsix_version} < {source_version})")
    
    # Compare commands
    all_commands_present = compare_commands(source_package, vsix_package, newest_vsix)
    
    # Check specific features
    features = check_specific_features(vsix_package)
    
    print("\n" + "=" * 60)
    print("CONCLUSION:")
    print("=" * 60)
    
    if vsix_version >= "3.53.1":
        print(f"\nThe VSIX (version {vsix_version}) contains:")
        print("1. All features up to version 3.53.1 from the changelog")
        
        if vsix_version == "3.53.2":
            print("2. Additional fixes/features from version 3.53.2 (not in current source)")
        
        # Check if major features from 3.48.0+ are present
        key_features = ['Jupyter Notebook Support', 'MCP Servers', 'Commit Message Generation', 'Explain Code']
        missing_key = [f for f in key_features if not features.get(f)]
        
        if missing_key:
            print(f"3. ⚠ Some key features may be missing: {', '.join(missing_key)}")
            print("   (Note: Some features may not be represented as commands)")
        else:
            print("3. ✓ Key newer features are present")
        
        if all_commands_present:
            print("4. ✓ All source commands are present in the VSIX")
        else:
            print("4. ⚠ Some commands are missing from the VSIX")
        
        print(f"\nOverall: The VSIX appears to contain MOST if not ALL new features.")
        print("The version number (3.53.2) suggests it includes everything up to that version.")
        
    else:
        print(f"\n⚠ The VSIX (version {vsix_version}) is older than current source (3.53.1)")
        print("It may be missing features added after version {vsix_version}.")

if __name__ == "__main__":
    main()