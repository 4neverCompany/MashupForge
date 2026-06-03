import json
import os
import urllib.request
import sys

# SECURITY: See create-release.py for the env-var pattern. This script
# previously hardcoded a GitHub PAT (pre-v1.0.4) and was rewritten to
# read from GITHUB_TOKEN env var instead. This script is SUPERSEDED.

with open('/workspace/v1.0.2-notes.md', 'r') as f:
    body = f.read()

token = os.environ.get('GITHUB_TOKEN')
if not token:
    print('ERROR: GITHUB_TOKEN env var is required.', file=sys.stderr)
    sys.exit(1)

data = {'body': body}

req = urllib.request.Request(
    'https://api.github.com/repos/Code4neverCompany/MashupForge/releases/333310377',
    data=json.dumps(data).encode('utf-8'),
    headers={
        'Authorization': f'token {token}',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mashupforge-release-script',
    },
    method='PATCH',
)

try:
    with urllib.request.urlopen(req) as resp:
        r = json.loads(resp.read().decode('utf-8'))
        print('id:', r.get('id'))
        print('tag:', r.get('tag_name'))
        print('body length:', len(r.get('body', '')))
        print('url:', r.get('html_url'))
except urllib.error.HTTPError as e:
    print('HTTP', e.code)
    print(e.read().decode('utf-8'))
