import os

def check_extension_for_fixes():
    """Check compiled extension.js for Bcline fixes"""
    extension_path = 'dist/extension.js'
    
    if not os.path.exists(extension_path):
        print("extension.js not found")
        return
    
    print("Checking compiled extension.js for Bcline fixes:")
    print("=" * 60)
    
    try:
        with open(extension_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            
            # Check for Windows dictation fix
            # Look for patterns that might indicate the fix
            if 'featureEnabled:true' in content.replace(' ', ''):
                print("✓ Found 'featureEnabled:true' (Windows dictation fix)")
            elif 'process.platform==="darwin"||process.platform==="linux"' in content.replace(' ', ''):
                print("✗ Found platform restriction (original dictation code)")
            else:
                print("? Could not find dictation configuration")
            
            # Check for Logger usage
            if 'Logger.log("[MessageQueue]"' in content or 'Logger.log(`[MessageQueue]' in content:
                print("✓ Found Logger.log usage (Bcline change)")
            elif 'console.log("[MessageQueue]"' in content or 'console.log(`[MessageQueue]' in content:
                print("✗ Found console.log usage (original)")
            else:
                print("? Could not find MessageQueue logging")
            
            # Check for Bcline branding in compiled code
            if 'bcline' in content.lower():
                print("✓ Found 'bcline' references in code")
            else:
                print("✗ No 'bcline' references found")
            
            # Check version
            import re
            version_match = re.search(r'version["\']:\s*["\']([\d.]+)["\']', content)
            if version_match:
                print(f"✓ Version found: {version_match.group(1)}")
            else:
                print("? Version not found")
                
    except Exception as e:
        print(f"Error reading extension.js: {e}")

def check_vsix_against_local():
    """Compare VSIX with local build"""
    print("\n" + "=" * 60)
    print("Analysis:")
    print("=" * 60)
    
    print("\n1. Local build exists (dist/extension.js from today)")
    print("2. Current source has Bcline fixes:")
    print("   - Windows dictation enabled")
    print("   - Logger service instead of console.log")
    print("   - Mixed branding (commands: bcline.*, displayName: Cline)")
    
    print("\n3. VSIX cline-3.53.2-clean.vsix:")
    print("   - Version 3.53.2 (newer than source 3.53.1)")
    print("   - Standard Cline branding (claude-dev, Cline)")
    print("   - Cannot check compiled fixes directly")
    
    print("\nConclusion:")
    print("- If VSIX was built from current local source, it includes Bcline fixes")
    print("- VSIX version 3.53.2 suggests it might be from upstream, not local")
    print("- Need to check build timestamp or metadata")

if __name__ == "__main__":
    check_extension_for_fixes()
    check_vsix_against_local()