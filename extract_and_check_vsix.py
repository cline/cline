import zipfile
import json
import os
import tempfile

def extract_and_check_vsix(vsix_filename):
    """Extract and check VSIX for Bcline changes"""
    downloads_path = r"C:\Users\bob43\Downloads"
    vsix_path = os.path.join(downloads_path, vsix_filename)
    
    print(f"\n{'='*60}")
    print(f"Analyzing: {vsix_filename}")
    print(f"{'='*60}")
    
    if not os.path.exists(vsix_path):
        print(f"File not found: {vsix_path}")
        return
    
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            # List all files to understand structure
            all_files = z.namelist()
            
            # Find package.json
            package_json_files = [f for f in all_files if f.endswith('package.json')]
            print(f"\nFound {len(package_json_files)} package.json files")
            
            for pkg_file in package_json_files:
                if 'extension/' in pkg_file:
                    print(f"Using: {pkg_file}")
                    pkg_content = z.read(pkg_file).decode('utf-8')
                    pkg_data = json.loads(pkg_content)
                    
                    print(f"  Name: {pkg_data.get('name')}")
                    print(f"  Display Name: {pkg_data.get('displayName')}")
                    print(f"  Version: {pkg_data.get('version')}")
                    print(f"  Publisher: {pkg_data.get('publisher')}")
                    break
            
            # Find controller/index.ts
            controller_files = [f for f in all_files if 'controller/index.ts' in f and f.endswith('.ts')]
            print(f"\nFound {len(controller_files)} controller/index.ts files")
            
            for ctrl_file in controller_files[:1]:  # Check first one
                print(f"Checking: {ctrl_file}")
                try:
                    ctrl_content = z.read(ctrl_file).decode('utf-8')
                    
                    # Check for Windows dictation fix
                    if 'featureEnabled: true' in ctrl_content and 'dictationEnabled: true' in ctrl_content:
                        print("  ✓ Windows dictation fix present")
                    elif 'process.platform === "darwin" || process.platform === "linux"' in ctrl_content:
                        print("  ✗ Original restrictive dictation (Windows not enabled)")
                    else:
                        print("  ? Could not determine dictation configuration")
                        
                    # Show snippet around dictation code
                    lines = ctrl_content.split('\n')
                    for i, line in enumerate(lines):
                        if 'featureEnabled' in line or 'dictationEnabled' in line:
                            start = max(0, i-2)
                            end = min(len(lines), i+3)
                            print("  Snippet:")
                            for j in range(start, end):
                                print(f"    {lines[j]}")
                            break
                except Exception as e:
                    print(f"  Error reading: {e}")
            
            # Find MessageQueueService.ts
            mq_files = [f for f in all_files if 'MessageQueueService.ts' in f and f.endswith('.ts')]
            print(f"\nFound {len(mq_files)} MessageQueueService.ts files")
            
            for mq_file in mq_files[:1]:
                print(f"Checking: {mq_file}")
                try:
                    mq_content = z.read(mq_file).decode('utf-8')
                    
                    # Check for Logger usage
                    if 'Logger.log(`[MessageQueue]' in mq_content:
                        print("  ✓ Uses Logger service (Bcline change)")
                    elif 'console.log(`[MessageQueue]' in mq_content:
                        print("  ✗ Uses console.log (original)")
                    else:
                        print("  ? Could not find logging pattern")
                        
                    # Show snippet around logging
                    lines = mq_content.split('\n')
                    for i, line in enumerate(lines):
                        if '[MessageQueue]' in line:
                            start = max(0, i-1)
                            end = min(len(lines), i+2)
                            print("  Snippet:")
                            for j in range(start, end):
                                print(f"    {lines[j]}")
                            break
                except Exception as e:
                    print(f"  Error reading: {e}")
                    
    except Exception as e:
        print(f"Error processing VSIX: {e}")

def main():
    vsix_files = [
        "cline-3.53.2-clean.vsix",
        "claude-dev-3.53.1.vsix",
        "bcline-3.50.0.vsix"
    ]
    
    for vsix_file in vsix_files:
        extract_and_check_vsix(vsix_file)

if __name__ == "__main__":
    main()