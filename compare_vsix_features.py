import zipfile
import json
import os

def extract_package_json(vsix_path):
    """Extract and parse package.json from VSIX"""
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            # Look for package.json
            package_json_path = None
            for name in z.namelist():
                if name.endswith('package.json') and 'extension/' in name:
                    package_json_path = name
                    break
            
            if package_json_path:
                package_content = z.read(package_json_path).decode('utf-8')
                return json.loads(package_content)
    except Exception as e:
        print(f"Error extracting package.json: {e}")
    return None

def check_feature_indicators(package_data):
    """Check package.json for indicators of features"""
    indicators = {}
    
    # Check version
    indicators['version'] = package_data.get('version', 'unknown')
    
    # Check commands (new features often add commands)
    commands = package_data.get('contributes', {}).get('commands', [])
    indicators['command_count'] = len(commands)
    
    # Check for specific commands that indicate features
    command_titles = [cmd.get('title', '').lower() for cmd in commands]
    
    # Look for feature indicators
    feature_checks = {
        'jupyter': any('jupyter' in title for title in command_titles),
        'skills': any('skill' in title for title in command_titles),
        'mcp': any('mcp' in title for title in command_titles),
        'commit': any('commit' in title for title in command_titles),
        'explain': any('explain' in title for title in command_titles),
        'voice': any('voice' in title for title in command_titles),
        'focus': any('focus' in title for title in command_titles),
    }
    
    indicators['feature_checks'] = feature_checks
    
    # Check scripts for build indicators
    scripts = package_data.get('scripts', {})
    indicators['has_protos_script'] = 'protos' in scripts
    indicators['has_webview_build'] = 'build:webview' in scripts
    
    return indicators

def main():
    downloads_path = r"C:\Users\bob43\Downloads"
    newest_vsix = "cline-3.53.2-clean.vsix"
    old_vsix = "bcline-3.47.0.vsix"
    
    newest_path = os.path.join(downloads_path, newest_vsix)
    old_path = os.path.join(downloads_path, old_vsix)
    
    print("Comparing VSIX features:")
    print("=" * 60)
    
    # Extract package.json from both
    newest_package = extract_package_json(newest_path)
    old_package = extract_package_json(old_path)
    
    if newest_package:
        print(f"\n{newest_vsix} (version {newest_package.get('version', 'unknown')}):")
        newest_indicators = check_feature_indicators(newest_package)
        
        print(f"  Commands: {newest_indicators['command_count']}")
        print("  Feature indicators:")
        for feature, has_feature in newest_indicators['feature_checks'].items():
            print(f"    - {feature}: {'YES' if has_feature else 'no'}")
        
        # Check for specific newer features from changelog
        print("\n  Looking for specific features from changelog 3.48.0+:")
        
        # Check commands for specific features
        commands = newest_package.get('contributes', {}).get('commands', [])
        command_titles = [cmd.get('title', '') for cmd in commands]
        
        # Features to check for (from changelog 3.48.0+)
        feature_keywords = {
            'Skills': 'skills system (3.48.0+)',
            'Jupyter': 'jupyter notebook support (3.52.0+)', 
            'GPT-5': 'gpt-5 models (various versions)',
            'Create Pull Request': 'create-pull-request skill (3.50.0+)',
            'Explain Changes': 'explain changes feature (3.39.0+)',
            'Focus Chain': 'focus chain (3.25.0+)',
            'Voice': 'voice mode (3.31.0+)',
            'Commit Message': 'generate commit message (3.28.3+)',
        }
        
        for keyword, description in feature_keywords.items():
            found = any(keyword.lower() in title.lower() for title in command_titles)
            print(f"    - {keyword}: {'✓' if found else '✗'} ({description})")
    
    if old_package:
        print(f"\n{old_vsix} (version {old_package.get('version', 'unknown')}):")
        old_indicators = check_feature_indicators(old_package)
        print(f"  Commands: {old_indicators['command_count']}")
    
    # Also check current source package.json
    print("\n" + "=" * 60)
    print("Current source code (package.json):")
    try:
        with open('package.json', 'r', encoding='utf-8') as f:
            source_package = json.load(f)
            source_version = source_package.get('version', 'unknown')
            print(f"  Version: {source_version}")
            
            # Compare with newest VSIX
            if newest_package:
                newest_version = newest_package.get('version', 'unknown')
                if newest_version == source_version:
                    print(f"  ✓ VSIX version matches source code")
                elif newest_version > source_version:
                    print(f"  ⚠ VSIX version ({newest_version}) is NEWER than source ({source_version})")
                else:
                    print(f"  ⚠ VSIX version ({newest_version}) is OLDER than source ({source_version})")
    except Exception as e:
        print(f"  Error reading source package.json: {e}")

if __name__ == "__main__":
    main()