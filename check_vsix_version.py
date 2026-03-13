import zipfile
import json
import os
import sys

def get_vsix_version(vsix_path):
    """Extract version from VSIX file"""
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            # Try to read extension.vsixmanifest
            if 'extension.vsixmanifest' in z.namelist():
                manifest_content = z.read('extension.vsixmanifest').decode('utf-8')
                # Parse version from manifest
                import re
                version_match = re.search(r'<Identity.*?Version="([^"]+)"', manifest_content)
                if version_match:
                    return version_match.group(1)
            
            # Try to read package.json
            if 'extension/package.json' in z.namelist():
                package_content = z.read('extension/package.json').decode('utf-8')
                package_data = json.loads(package_content)
                return package_data.get('version', 'unknown')
            
            # Try other possible paths
            for name in z.namelist():
                if name.endswith('package.json'):
                    try:
                        package_content = z.read(name).decode('utf-8')
                        package_data = json.loads(package_content)
                        if 'version' in package_data:
                            return package_data.get('version')
                    except:
                        continue
            
            return "unknown"
    except Exception as e:
        return f"error: {str(e)}"

def list_vsix_files(vsix_path):
    """List files in VSIX"""
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            return z.namelist()
    except Exception as e:
        return f"error: {str(e)}"

if __name__ == "__main__":
    downloads_path = r"C:\Users\bob43\Downloads"
    
    # Check all VSIX files in Downloads
    vsix_files = [
        "cline-3.53.2-clean.vsix",
        "claude-dev-3.53.1.vsix", 
        "claude-dev-3.49.0.vsix",
        "claude-dev-3.48.0.vsix",
        "bcline-3.50.0.vsix",
        "bcline-3.47.0.vsix"
    ]
    
    print("Checking VSIX versions in Downloads:")
    print("=" * 60)
    
    for vsix_file in vsix_files:
        vsix_path = os.path.join(downloads_path, vsix_file)
        if os.path.exists(vsix_path):
            version = get_vsix_version(vsix_path)
            print(f"{vsix_file}: {version}")
            
            # List some key files for the newest one
            if vsix_file == "cline-3.53.2-clean.vsix":
                print(f"\nKey files in {vsix_file}:")
                files = list_vsix_files(vsix_path)
                if isinstance(files, list):
                    # Show some important files
                    important_files = [f for f in files if any(x in f for x in [
                        'package.json', 'extension.vsixmanifest', 'dist/', 
                        'webview-ui/', 'src/', 'CHANGELOG.md'
                    ])]
                    for f in sorted(important_files)[:20]:  # Show first 20
                        print(f"  {f}")
        else:
            print(f"{vsix_file}: File not found")