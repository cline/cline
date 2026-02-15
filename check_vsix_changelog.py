nd new feature from import zipfile
import os

def extract_changelog(vsix_path):
    """Extract CHANGELOG.md from VSIX"""
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            # Look for CHANGELOG.md
            changelog_path = None
            for name in z.namelist():
                if 'CHANGELOG.md' in name and name.endswith('.md'):
                    changelog_path = name
                    break
            
            if changelog_path:
                changelog_content = z.read(changelog_path).decode('utf-8')
                return changelog_content
    except Exception as e:
        print(f"Error extracting changelog: {e}")
    return None

def check_features_in_changelog(changelog_content, version):
    """Check what features are listed in changelog for given version"""
    if not changelog_content:
        return []
    
    lines = changelog_content.split('\n')
    features = []
    in_target_version = False
    
    for line in lines:
        # Look for version header
        if line.startswith('## ['):
            if version in line:
                in_target_version = True
            elif in_target_version:
                # Reached next version, stop
                break
        
        # Collect feature lines when in target version
        if in_target_version and line.strip():
            # Skip version header and empty lines
            if not line.startswith('## [') and line.strip():
                # Clean up markdown bullets
                clean_line = line.strip().lstrip('*- ')
                if clean_line and not clean_line.startswith('#'):
                    features.append(clean_line)
    
    return features

def main():
    downloads_path = r"C:\Users\bob43\Downloads"
    newest_vsix = "cline-3.53.2-clean.vsix"
    newest_path = os.path.join(downloads_path, newest_vsix)
    
    print(f"Checking changelog in {newest_vsix}:")
    print("=" * 60)
    
    changelog = extract_changelog(newest_path)
    if changelog:
        # Get first few lines to see version range
        lines = changelog.split('\n')[:50]
        print("First 50 lines of changelog:")
        for line in lines[:50]:
            print(line)
        
        # Check features for version 3.53.2
        print(f"\nFeatures in version 3.53.2:")
        features = check_features_in_changelog(changelog, "3.53.2")
        if features:
            for i, feature in enumerate(features[:20], 1):  # Show first 20
                print(f"  {i}. {feature}")
        else:
            print("  No features found or version not in changelog")
            
        # Also check 3.53.1
        print(f"\nFeatures in version 3.53.1:")
        features = check_features_in_changelog(changelog, "3.53.1")
        if features:
            for i, feature in enumerate(features[:20], 1):
                print(f"  {i}. {feature}")
        else:
            print("  No features found or version not in changelog")
    else:
        print("No changelog found in VSIX")

if __name__ == "__main__":
    main()