import json
import os
import urllib.request
import sys

# SECURITY: This script reads the GitHub PAT from the GITHUB_TOKEN env var
# instead of hardcoding it. The previous version (pre-v1.0.4) had a
# hardcoded token; this rewrite eliminates that footgun. The user (Maurice)
# has the real token in their shell env, so this script must be invoked as:
#
#   GITHUB_TOKEN=ghp_xxx python3 create-release.py
#
# (or with the env var already set in the calling shell).
#
# This script is SUPERSEDED — see scripts/release.sh + .claude/rules/release-flow.md
# for the current way to ship a release. Kept for archeology only.

with open('/workspace/v1.0.1-notes.md', 'r') as f:
    body = f.read()

token = os.environ.get('GITHUB_TOKEN')
if not token:
    print('ERROR: GITHUB_TOKEN env var is required. Set it in your shell:', file=sys.stderr)
    print('  export GITHUB_TOKEN=ghp_xxx', file=sys.stderr)
    sys.exit(1)

data = {
    'tag_name': 'v1.0.1',
    'name': 'MashupForge v1.0.1 — v0.9.41 production fix',
    'draft': True,
    'prerelease': False,
    'body': body,
}

req = urllib.request.Request(
    'https://api.github.com/repos/Code4neverCompany/MashupForge/releases',
    data=json.dumps(data).encode('utf-8'),
    headers={
        'Authorization': f'token {token}',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mashupforge-release-script',
    },
    method='POST',
)

try:
    with urllib.request.urlopen(req) as resp:
        r = json.loads(resp.read().decode('utf-8'))
        print('id:', r.get('id'))
        print('url:', r.get('html_url'))
        print('upload_url:', r.get('upload_url', '')[:80])
except urllib.error.HTTPError as e:
    print('HTTP', e.code)
    print(e.read().decode('utf-8'))
