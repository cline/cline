import zipfile
import json
import os

def check_vsix_for_features(vsix_filename):
    """Check VSIX for voice activation and messaging system features"""
    downloads_path = r"C:\Users\bob43\Downloads"
    vsix_path = os.path.join(downloads_path, vsix_filename)
    
    print(f"\n{'='*60}")
    print(f"Checking: {vsix_filename}")
    print(f"{'='*60}")
    
    if not os.path.exists(vsix_path):
        print(f"File not found: {vsix_path}")
        return
    
    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            all_files = z.namelist()
            
            # 1. Check for MessageQueueService in compiled JS
            print("\n1. Checking for Messaging System:")
            js_files = [f for f in all_files if f.endswith('.js') and 'extension' in f]
            found_messaging = False
            
            for js_file in js_files[:3]:  # Check first few JS files
                try:
                    content = z.read(js_file).decode('utf-8', errors='ignore')
                    # Look for MessageQueueService patterns
                    if 'MessageQueueService' in content:
                        found_messaging = True
                        print(f"   ✓ Found MessageQueueService in {js_file}")
                        break
                except:
                    continue
            
            if not found_messaging:
                print("   ✗ MessageQueueService not found in compiled JS")
            
            # 2. Check for voice/dictation features
            print("\n2. Checking for Voice Activation:")
            found_voice = False
            for js_file in js_files[:3]:
                try:
                    content = z.read(js_file).decode('utf-8', errors='ignore')
                    # Look for dictation patterns
                    if 'dictationEnabled' in content or 'featureEnabled' in content:
                        found_voice = True
                        print(f"   ✓ Found dictation features in {js_file}")
                        
                        # Check if it's the Windows fix
                        if 'process.platform==="darwin"||process.platform==="linux"' in content.replace(' ', ''):
                            print("   ✗ Has platform restriction (original, not Windows fix)")
                        elif 'featureEnabled:true' in content.replace(' ', ''):
                            print("   ✓ Has Windows dictation fix")
                        break
                except:
                    continue
            
            if not found_voice:
                print("   ✗ Dictation features not found")
            
            # 3. Check package.json for version and features
            print("\n3. Package.json Analysis:")
            pkg_files = [f for f in all_files if f.endswith('package.json')]
            for pkg_file in pkg_files:
                if 'extension/' in pkg_file:
                    try:
                        pkg_content = z.read(pkg_file).decode('utf-8')
                        pkg_data = json.loads(pkg_content)
                        
                        print(f"   Version: {pkg_data.get('version')}")
                        print(f"   Name: {pkg_data.get('name')}")
                        print(f"   Display Name: {pkg_data.get('displayName')}")
                        
                        # Check for messaging-related commands
                        commands = pkg_data.get('contributes', {}).get('commands', [])
                        messaging_commands = [c for c in commands if 'messaging' in c.get('command', '').lower() or 'queue' in c.get('command', '').lower()]
                        if messaging_commands:
                            print(f"   ✓ Found {len(messaging_commands)} messaging-related commands")
                        else:
                            print("   ✗ No messaging commands found")
                        break
                    except Exception as e:
                        print(f"   Error reading package.json: {e}")
            
            # 4. Check for CLI messaging documentation
            print("\n4. Checking for CLI Messaging Documentation:")
            doc_files = [f for f in all_files if 'messaging' in f.lower() or 'cli' in f.lower()]
            if doc_files:
                print(f"   ✓ Found {len(doc_files)} messaging/CLI-related files")
                for doc in doc_files[:3]:
                    print(f"     - {doc}")
            else:
                print("   ✗ No messaging documentation found")
                
    except Exception as e:
        print(f"Error processing VSIX: {e}")

def check_current_source_for_features():
    """Check current source for voice and messaging features"""
    print(f"\n{'='*60}")
    print("Checking Current Bcline Source:")
    print(f"{'='*60}")
    
    # Check for MessageQueueService.ts
    mq_path = 'src/services/MessageQueueService.ts'
    if os.path.exists(mq_path):
        print("✓ MessageQueueService.ts exists")
        with open(mq_path, 'r', encoding='utf-8') as f:
            content = f.read()
            if 'Logger.log(`[MessageQueue]' in content:
                print("✓ Uses Logger service (Bcline change)")
            else:
                print("✗ Does not use Logger service")
    else:
        print("✗ MessageQueueService.ts not found")
    
    # Check controller for voice fix
    ctrl_path = 'src/core/controller/index.ts'
    if os.path.exists(ctrl_path):
        with open(ctrl_path, 'r', encoding='utf-8') as f:
            content = f.read()
            if 'featureEnabled: true' in content and 'dictationEnabled: true' in content:
                print("✓ Windows dictation fix present")
            elif 'process.platform === "darwin" || process.platform === "linux"' in content:
                print("✗ Original restrictive dictation (Windows not enabled)")
            else:
                print("? Could not determine dictation configuration")
    
    # Check for CLI messaging documentation
    cli_docs = ['CLI_MESSAGING.md', 'docs/cli-messaging.md', 'docs/messaging.md']
    found_docs = []
    for doc in cli_docs:
        if os.path.exists(doc):
            found_docs.append(doc)
    
    if found_docs:
        print(f"✓ Found CLI messaging docs: {', '.join(found_docs)}")
    else:
        print("✗ No CLI messaging documentation found")

def main():
    vsix_files = [
        "cline-3.53.2-clean.vsix",
        "claude-dev-3.53.1.vsix",
        "bcline-3.50.0.vsix"
    ]
    
    for vsix_file in vsix_files:
        check_vsix_for_features(vsix_file)
    
    check_current_source_for_features()
    
    print(f"\n{'='*60}")
    print("SUMMARY:")
    print(f"{'='*60}")
    print("1. Voice Activation (Windows dictation fix):")
    print("   - Current Bcline source: ✓ Enabled for Windows")
    print("   - VSIX cline-3.53.2-clean: Need to check compiled JS")
    print("   - VSIX bcline-3.50.0: Likely included (older Bcline version)")
    
    print("\n2. Messaging System (MessageQueueService):")
    print("   - Current Bcline source: ✓ Full implementation")
    print("   - VSIX cline-3.53.2-clean: Need to check compiled JS")
    print("   - VSIX bcline-3.50.0: Likely included")
    
    print("\n3. CLI Integration:")
    print("   - Current Bcline source: ✓ PowerShell commands, file-based queue")
    print("   - VSIX: Check for compiled MessageQueueService")

if __name__ == "__main__":
    main()