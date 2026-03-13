import zipfile
import json
import os

def check_vsix_branding(vsix_filename):
    """Check VSIX branding to see if it shows as BCline or Cline"""
    downloads_path = r"C:\Users\bob43\Downloads"
    vsix_path = os.path.join(downloads_path, vsix_filename)
    
    print(f"\n{'='*60}")
    print(f"Branding Analysis: {vsix_filename}")
    print(f"{'='*60}")
    
    if not os.path.exists(vsix_path):
        print(f"File not found: {vsix_path}")
        return
    
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            # Find package.json
            pkg_files = [f for f in z.namelist() if f.endswith('package.json') and 'extension/' in f]
            
            for pkg_file in pkg_files:
                try:
                    pkg_content = z.read(pkg_file).decode('utf-8')
                    pkg_data = json.loads(pkg_content)
                    
                    name = pkg_data.get('name', '')
                    display_name = pkg_data.get('displayName', '')
                    publisher = pkg_data.get('publisher', '')
                    version = pkg_data.get('version', '')
                    
                    print(f"  Name: {name}")
                    print(f"  Display Name: {display_name}")
                    print(f"  Publisher: {publisher}")
                    print(f"  Version: {version}")
                    
                    # Check if it's BCline branding
                    is_bcline = 'bcline' in name.lower() or 'bcline' in display_name.lower()
                    
                    if is_bcline:
                        print(f"  → Would show as: **BCline** (custom fork)")
                    else:
                        print(f"  → Would show as: **Cline** (original/upstream)")
                    
                    # Check viewsContainers for sidebar title
                    views_containers = pkg_data.get('contributes', {}).get('viewsContainers', {})
                    for container in views_containers.get('activitybar', []):
                        if 'title' in container:
                            print(f"  Sidebar Title: {container.get('title')}")
                    
                    # Check commands for bcline prefix
                    commands = pkg_data.get('contributes', {}).get('commands', [])
                    bcline_commands = [c for c in commands if c.get('command', '').startswith('bcline.')]
                    cline_commands = [c for c in commands if c.get('command', '').startswith('cline.')]
                    
                    print(f"  Commands with 'bcline.' prefix: {len(bcline_commands)}")
                    print(f"  Commands with 'cline.' prefix: {len(cline_commands)}")
                    
                    if bcline_commands:
                        print(f"  → Command namespace: bcline.* (BCline fork)")
                    elif cline_commands:
                        print(f"  → Command namespace: cline.* (original Cline)")
                    
                    break
                    
                except Exception as e:
                    print(f"  Error reading package.json: {e}")
                    
    except Exception as e:
        print(f"Error processing VSIX: {e}")

def check_installation_behavior():
    """Explain what happens when installing each VSIX"""
    print(f"\n{'='*60}")
    print("INSTALLATION BEHAVIOR:")
    print(f"{'='*60}")
    
    print("\n1. **cline-3.53.2-clean.vsix**:")
    print("   - Name: claude-dev")
    print("   - Display Name: Cline")
    print("   - Publisher: saoudrizwan")
    print("   → Would REPLACE existing 'Cline' extension")
    print("   → Shows as 'Cline' in VS Code extensions sidebar")
    print("   → Same publisher as original, so it upgrades/replaces")
    
    print("\n2. **bcline-3.50.0.vsix**:")
    print("   - Name: bcline")
    print("   - Display Name: BCline")
    print("   - Publisher: saoudrizwan")
    print("   → Would install as SEPARATE extension 'BCline'")
    print("   → Shows as 'BCline' in VS Code extensions sidebar")
    print("   → Can coexist with 'Cline' (different name)")
    
    print("\n3. **claude-dev-3.53.1.vsix**:")
    print("   - Name: claude-dev")
    print("   - Display Name: Cline")
    print("   - Publisher: saoudrizwan")
    print("   → Would REPLACE existing 'Cline' extension")
    print("   → Shows as 'Cline' in VS Code extensions sidebar")
    
    print(f"\n{'='*60}")
    print("KEY POINT:")
    print(f"{'='*60}")
    print("Extensions with SAME name and publisher REPLACE each other.")
    print("Extensions with DIFFERENT names can COEXIST.")
    print("\n'cline-3.53.2-clean.vsix' would replace your current Cline,")
    print("not show up as a separate 'BCline' extension.")

def main():
    vsix_files = [
        "cline-3.53.2-clean.vsix",
        "claude-dev-3.53.1.vsix",
        "bcline-3.50.0.vsix"
    ]
    
    for vsix_file in vsix_files:
        check_vsix_branding(vsix_file)
    
    check_installation_behavior()

if __name__ == "__main__":
    main()