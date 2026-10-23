#!/usr/bin/env python3
"""Inspect a named simulator and its real Cline installation without changing state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True)
parser.add_argument('--evidence-dir', required=True)
parser.add_argument('--expected-version')
args = parser.parse_args()

def run(*command):
    return subprocess.run(command, text=True, capture_output=True)

report = {'device': args.device, 'bundle_id': 'bot.cline.app', 'checks': {}, 'errors': []}
devices = run('xcrun', 'simctl', 'list', 'devices', '--json')
if devices.returncode:
    report['errors'].append('simctl device listing failed')
else:
    device = next((d for rows in json.loads(devices.stdout)['devices'].values()
                   for d in rows if d['udid'] == args.device), None)
    report['checks']['device_state'] = device['state'] if device else 'missing'
    if not device or device['state'] != 'Booted':
        report['errors'].append('The requested simulator must be booted')
container = run('xcrun', 'simctl', 'get_app_container', args.device, 'bot.cline.app', 'app')
if container.returncode:
    report['errors'].append('Cline is not installed or its app container cannot be read')
else:
    app = Path(container.stdout.strip())
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    report['checks'].update(version=info.get('CFBundleShortVersionString'),
                            build=info.get('CFBundleVersion'),
                            bundle_id=info.get('CFBundleIdentifier'),
                            bundled_javascript=(app / 'main.jsbundle').is_file())
    if (app / 'main.jsbundle').is_file():
        report['checks']['javascript_sha256'] = hashlib.sha256((app / 'main.jsbundle').read_bytes()).hexdigest()
    if info.get('CFBundleIdentifier') != 'bot.cline.app':
        report['errors'].append('Installed bundle identity is wrong')
    if not (app / 'main.jsbundle').is_file():
        report['errors'].append('Expected a Release app with bundled JavaScript')
    if args.expected_version and info.get('CFBundleShortVersionString') != args.expected_version:
        report['errors'].append('Installed version differs from expected version')
report['checks']['maestro'] = shutil.which('maestro')
report['checks']['java_home'] = os.environ.get('JAVA_HOME')
java = run('java', '-version') if shutil.which('java') else None
report['checks']['java_available'] = java is not None and java.returncode == 0
if not report['checks']['maestro'] or not report['checks']['java_available']:
    report['errors'].append('Maestro and a working Java runtime are required')
evidence = Path(args.evidence_dir).expanduser().resolve()
evidence.mkdir(parents=True, exist_ok=True)
(evidence / 'doctor.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
raise SystemExit(bool(report['errors']))
