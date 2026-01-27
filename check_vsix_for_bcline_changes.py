import zipfile
import json
import os
import tempfile

def extract_file_from_vsix(vsix_path, file_path):
    """Extract a specific file from VSIX"""
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            # Look for the file in the VSIX
            for name in z.namelist():
                if file_path in name:
                    return z.read(name).decode('utf-8')
    except Exception as e:
        print(f"Error extracting {file_path}: {e}")
    return None

def check_bcline_changes_in_vsix(vsix_path):
    """Check if VSIX contains Bcline-specific changes"""
    downloads_path = r"C:\Users\bob43\Downloads"
    vsix_path = os.path.join(downloads_path, vsix_path)
    
    print(f"Checking Bcline changes in {vsix_path}:")
    print("=" * 60)
    
    # 1. Check package.json for Bcline branding
    print("\n1. Checking package.json for Bcline branding:")
    vsix_package_json = extract_file_from_vsix(vsix_path, 'package.json')
    if vsix_package_json:
        vsix_package = json.loads(vsix_package_json)
        
        name = vsix_package.get('name', '')
        display_name = vsix_package.get('displayName', '')
        publisher = vsix_package.get('publisher', '')
        
        print(f"   Name: {name}")
        print(f"   Display Name: {display_name}")
        print(f"   Publisher: {publisher}")
        
        # Check if it has Bcline branding
        is_bcline = 'bcline' in name.lower() or 'bcline' in display_name.lower()
        if is_bcline:
            print("   ✓ Has Bcline branding")
        else:
            print("   ✗ Has standard Cline branding (not Bcline)")
    else:
        print("   Could not extract package.json")
    
    # 2. Check controller/index.ts for Windows dictation fix
    print("\n2. Checking controller/index.ts for Windows dictation fix:")
    controller_content = extract_file_from_vsix(vsix_path, 'src/core/controller/index.ts')
    if controller_content:
        # Look for the Windows dictation fix
        # Original: featureEnabled: process.platform === "darwin" || process.platform === "linux"
        # Bcline fix: featureEnabled: true, dictationEnabled: true
        if 'featureEnabled: true' in controller_content and 'dictationEnabled: true' in controller_content:
            print("   ✓ Windows dictation fix present")
        else:
            # Check for original restrictive code
            if 'process.platform === "darwin" || process.platform === "linux"' in controller_content:
                print("   ✗ Original restrictive dictation code (Windows not enabled)")
            else:
                print("   ? Could not determine dictation configuration")
    else:
        print("   Could not extract controller/index.ts")
    
    # 3. Check MessageQueueService.ts for Logger usage
    print("\n3. Checking MessageQueueService.ts for Logger usage:")
    mq_content = extract_file_from_vsix(vsix_path, 'src/services/MessageQueueService.ts')
    if mq_content:
        # Bcline uses Logger.log instead of console.log
        if 'Logger.log(`[MessageQueue]' in mq_content:
            print("   ✓ Uses Logger service (Bcline change)")
        elif 'console.log(`[MessageQueue]' in mq_content:
            print("   ✗ Uses console.log (original, not Bcline change)")
        else:
            print("   ? Could not find logging pattern")
    else:
        print("   Could not extract MessageQueueService.ts")
    
    return True

def compare_with_current_source(vsix_path):
    """Compare VSIX with current source files"""
    print("\n" + "=" * 60)
    print("Comparing with current Bcline source modifications:")
    print("=" * 60)
    
    # Read current source files
    try:
        with open('package.json', 'r', encoding='utf-8') as f:
            current_package = json.load(f)
            current_name = current_package.get('name', '')
            print(f"\nCurrent package.json name: {current_name}")
    except:
        print("Could not read current package.json")
    
    # Check controller/index.ts
    try:
        with open('src/core/controller/index.ts', 'r', encoding='utf-8') as f:
            controller_content = f.read()
            if 'featureEnabled: true' in controller_content and 'dictationEnabled: true' in controller_content:
                print("Current controller/index.ts: Has Windows dictation fix")
            else:
                print("Current controller/index.ts: Does not have Windows dictation fix")
    except:
        print("Could not read current controller/index.ts")
    
    # Check MessageQueueService.ts
    try:
        with open('src/services/MessageQueueService.ts', 'r', encoding='utf-8') as f:
            mq_content = f.read()
            if 'Logger.log(`[MessageQueue]' in mq_content:
                print("Current MessageQueueService.ts: Uses Logger service")
            else:
                print("Current MessageQueueService.ts: Does not use Logger service")
    except:
        print("Could not read current MessageQueueService.ts")

def main():
    vsix_files = [
        "cline-3.53.2-clean.vsix",
        "claude-dev-3.53.1.vsix",
        "bcline-3.50.0.vsix",
        "bcline-3.47.0.vsix"
    ]
    
    for vsix_file in vsix_files:
        check_bcline_changes_in_vsix(vsix_file)
        print("\n" + "=" * 60)
    
    # Compare with current source
    compare_with_current_source(None)

if __name__ == "__main__":
    main()