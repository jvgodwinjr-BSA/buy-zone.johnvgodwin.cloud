#!/usr/bin/env python3
"""Deploy the BuyZone collectors to the shared n8n instance through its public API.

n8n listens on 127.0.0.1:5678 on the VPS only, so this runs from a machine with SSH access to
the VPS and opens a tunnel itself (python stdlib only, no pip installs).

  python3 n8n/deploy.py --list       read-only: every workflow's name, id, active flag
  python3 n8n/deploy.py --dry-run    show exactly what would be created/updated, write nothing
  python3 n8n/deploy.py              create or update + activate the three "BuyZone — " workflows

Options: --env FILE (default n8n/deploy.env)   --no-tunnel   --base-url URL

Ground rules for the shared instance are enforced, not just documented: the script never writes
to a workflow whose name does not start with "BuyZone — ", never touches credentials it did not
create (their ids are remembered in n8n/.deploy-state.json), and never edits the database file.
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PREFIX = 'BuyZone — '
WORKFLOW_FILES = ['crypto-longterm.n8n.json', 'swing-setup.n8n.json', 'stocks-commodities.n8n.json']
STATE_FILE = os.path.join(ROOT, '.deploy-state.json')
LEGACY_NAME_HINT = 'btc buy-zone'          # the original alerts workflow, read only (never modified)
HEADER_AUTH_NODES = ['Get Assets', 'Ingest']
QUERY_AUTH_NODES = ['TD Daily', 'TD Weekly', 'TD 4h']


def log(msg):
    print(msg, flush=True)


def load_env(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {'credentials': {}, 'workflows': {}}


def save_state(state):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


class Tunnel:
    def __init__(self, ssh_target, local_port):
        self.ssh_target, self.local_port, self.proc = ssh_target, local_port, None

    def __enter__(self):
        cmd = ['ssh', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-N',
               '-L', f'127.0.0.1:{self.local_port}:127.0.0.1:5678', self.ssh_target]
        log(f'opening tunnel: {" ".join(cmd)}')
        self.proc = subprocess.Popen(cmd)
        for _ in range(60):
            if self.proc.poll() is not None:
                sys.exit(f'ssh exited with {self.proc.returncode} — check key access to {self.ssh_target}')
            try:
                with socket.create_connection(('127.0.0.1', self.local_port), timeout=0.5):
                    return self
            except OSError:
                time.sleep(0.25)
        sys.exit('tunnel did not come up within 15s')

    def __exit__(self, *exc):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


class Api:
    def __init__(self, base_url, api_key):
        self.base, self.key = base_url.rstrip('/'), api_key

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + '/api/v1' + path, data=data, method=method,
                                     headers={'X-N8N-API-KEY': self.key, 'Accept': 'application/json',
                                              'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')[:600]
            if e.code == 401:
                sys.exit('n8n API returned 401: the API key is missing or wrong (N8N_API_KEY in deploy.env)')
            if e.code == 404 and path == '/workflows':
                sys.exit('n8n API returned 404 for /api/v1/workflows: the public API is disabled '
                         '(N8N_PUBLIC_API_DISABLED) or the base URL is not n8n')
            raise SystemExit(f'{method} {path} -> HTTP {e.code}: {detail}')

    def list_workflows(self):
        out, cursor = [], None
        while True:
            page = self.call('GET', '/workflows?limit=100' + (f'&cursor={cursor}' if cursor else ''))
            out.extend(page.get('data', []))
            cursor = page.get('nextCursor')
            if not cursor:
                return out


def find_legacy_ntfy(api, workflows):
    """ntfy URL (and any hard-coded Authorization header) from the original alerts workflow."""
    for w in workflows:
        if LEGACY_NAME_HINT in w['name'].lower():
            full = api.call('GET', f'/workflows/{w["id"]}')
            for n in full.get('nodes', []):
                url = str(n.get('parameters', {}).get('url', ''))
                if n.get('type') == 'n8n-nodes-base.httpRequest' and ('ntfy' in n.get('name', '').lower() or 'ntfy' in url.lower()):
                    auth = None
                    for h in n.get('parameters', {}).get('headerParameters', {}).get('parameters', []):
                        if str(h.get('name', '')).lower() == 'authorization':
                            auth = h.get('value')
                    return w['name'], url, auth
    return None, None, None


def load_workflow(fname):
    with open(os.path.join(ROOT, 'workflows', fname)) as f:
        wf = json.load(f)
    # The public API rejects unknown top-level keys (id, active, pinData, meta, tags ...).
    return {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
            'settings': {k: v for k, v in wf.get('settings', {}).items() if k in ('executionOrder', 'timezone', 'saveManualExecutions', 'saveExecutionProgress', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow')}}


def node(wf, name):
    for n in wf['nodes']:
        if n['name'] == name:
            return n
    return None


def configure(wf, values):
    cfg = node(wf, 'Config')
    if not cfg:
        sys.exit(f'{wf["name"]}: no Config node')
    for a in cfg['parameters']['assignments']['assignments']:
        if a['name'] in values and values[a['name']]:
            a['value'] = values[a['name']]


def bind(wf, creds):
    for n in wf['nodes']:
        if n['name'] in HEADER_AUTH_NODES and 'ingest' in creds:
            n['credentials'] = {'httpHeaderAuth': creds['ingest']}
        elif n['name'] in QUERY_AUTH_NODES and 'twelvedata' in creds:
            n['credentials'] = {'httpQueryAuth': creds['twelvedata']}
        elif n['name'] == 'ntfy Push' and 'ntfy' in creds:
            n['parameters']['authentication'] = 'genericCredentialType'
            n['parameters']['genericAuthType'] = 'httpHeaderAuth'
            n['credentials'] = {'httpHeaderAuth': creds['ntfy']}


def check_connections(wf):
    names = {n['name'] for n in wf['nodes']}
    for src, conn in wf['connections'].items():
        if src not in names:
            sys.exit(f'{wf["name"]}: connection source "{src}" is not a node')
        for outputs in conn.get('main', []):
            for t in outputs:
                if t['node'] not in names:
                    sys.exit(f'{wf["name"]}: connection target "{t["node"]}" is not a node')


def ensure_credential(api, state, dry, key, name, ctype, data):
    if key in state['credentials']:
        c = state['credentials'][key]
        log(f'  credential {name}: reusing id {c["id"]} (from .deploy-state.json)')
        return {'id': c['id'], 'name': c['name']}
    if dry:
        log(f'  credential {name}: would create ({ctype})')
        return {'id': 'DRY', 'name': name}
    created = api.call('POST', '/credentials', {'name': name, 'type': ctype, 'data': data})
    c = {'id': created['id'], 'name': created.get('name', name)}
    state['credentials'][key] = c
    save_state(state)
    log(f'  credential {name}: created id {c["id"]}')
    return c


def upsert(api, state, dry, wf, existing_by_name):
    if not wf['name'].startswith(PREFIX):
        sys.exit(f'refusing to write a workflow not prefixed "{PREFIX}": {wf["name"]}')
    check_connections(wf)
    cur = existing_by_name.get(wf['name'])
    if dry:
        log(f'  {wf["name"]}: would {"update id " + cur["id"] if cur else "create"} and activate')
        return
    if cur:
        if cur.get('active'):
            api.call('POST', f'/workflows/{cur["id"]}/deactivate')
        saved = api.call('PUT', f'/workflows/{cur["id"]}', wf)
        log(f'  {wf["name"]}: updated id {saved["id"]}')
    else:
        saved = api.call('POST', '/workflows', wf)
        log(f'  {wf["name"]}: created id {saved["id"]}')
    state['workflows'][wf['name']] = saved['id']
    save_state(state)
    act = api.call('POST', f'/workflows/{saved["id"]}/activate')
    fresh = api.call('GET', f'/workflows/{saved["id"]}')
    ver = fresh.get('versionId')
    live = fresh.get('activeVersionId')
    status = 'active' if fresh.get('active') else 'NOT ACTIVE'
    extra = '' if live is None else (' · published' if live == ver else ' · DRAFT differs from published — click Publish in the UI')
    log(f'  {wf["name"]}: {status}{extra}')
    return fresh


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--env', default=os.path.join(ROOT, 'deploy.env'))
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-tunnel', action='store_true')
    ap.add_argument('--base-url')
    ap.add_argument('--local-port', type=int, default=15678)
    args = ap.parse_args()

    env = {**load_env(args.env), **{k: v for k, v in os.environ.items() if k in ('N8N_SSH', 'N8N_API_KEY', 'SITE_BASE_URL', 'SITE_API_TOKEN', 'TWELVEDATA_API_KEY', 'NTFY_URL', 'NTFY_TOKEN', 'BINANCE_BASE')}}
    if not env.get('N8N_API_KEY'):
        sys.exit(f'N8N_API_KEY is not set (put it in {args.env}, copied from n8n/deploy.env.example)')
    base = args.base_url or (f'http://127.0.0.1:{args.local_port}' if not args.no_tunnel else 'http://127.0.0.1:5678')
    tunnel = Tunnel(env.get('N8N_SSH', 'john@76.13.110.193'), args.local_port) if not args.no_tunnel else None

    def run():
        api = Api(base, env['N8N_API_KEY'])
        workflows = api.list_workflows()
        if args.list:
            for w in sorted(workflows, key=lambda w: w['name']):
                log(f'{"ACTIVE " if w.get("active") else "       "} {w["id"]:<20} {w["name"]}')
            return
        state = load_state()
        dry = args.dry_run
        log(('DRY RUN — ' if dry else '') + f'{len(workflows)} workflows on the instance; only "{PREFIX}…" ones are written.')

        legacy_name, legacy_url, legacy_auth = find_legacy_ntfy(api, workflows)
        ntfy_url = env.get('NTFY_URL') or legacy_url
        if legacy_url:
            log(f'ntfy URL from "{legacy_name}": {legacy_url}' + (' (has an Authorization header)' if legacy_auth else ''))
        if not ntfy_url:
            sys.exit('no ntfy URL: set NTFY_URL in deploy.env (the original alerts workflow was not found)')
        ntfy_token = env.get('NTFY_TOKEN') or (legacy_auth.split(' ', 1)[1] if legacy_auth and ' ' in legacy_auth else None)

        log('credentials:')
        creds = {}
        if env.get('SITE_API_TOKEN'):
            creds['ingest'] = ensure_credential(api, state, dry, 'ingest', PREFIX + 'Ingest Token', 'httpHeaderAuth',
                                                {'name': 'Authorization', 'value': 'Bearer ' + env['SITE_API_TOKEN']})
        else:
            log('  SITE_API_TOKEN not set: Get Assets / Ingest nodes are left unbound — attach a Header Auth credential in the UI')
        creds['twelvedata'] = ensure_credential(api, state, dry, 'twelvedata', PREFIX + 'Twelve Data', 'httpQueryAuth',
                                                {'name': 'apikey', 'value': env.get('TWELVEDATA_API_KEY') or 'placeholder'})
        if ntfy_token:
            creds['ntfy'] = ensure_credential(api, state, dry, 'ntfy', PREFIX + 'ntfy', 'httpHeaderAuth',
                                              {'name': 'Authorization', 'value': 'Bearer ' + ntfy_token})

        existing = {w['name']: w for w in workflows}
        log('workflows:')
        for fname in WORKFLOW_FILES:
            wf = load_workflow(fname)
            configure(wf, {'base_url': env.get('SITE_BASE_URL'), 'ntfy_url': ntfy_url, 'binance_base': env.get('BINANCE_BASE')})
            bind(wf, creds)
            upsert(api, state, dry, wf, existing)

        if not dry:
            log('\nNext: open the n8n UI through your tunnel, confirm each "BuyZone — " workflow shows as published/active '
                '(click Publish if it reports unsaved/unpublished changes), run "Test workflow" once on each, then check '
                f'{env.get("SITE_BASE_URL", "the site")}/investing/ for data. The original alerts workflow was not modified.')

    if tunnel:
        with tunnel:
            run()
    else:
        run()


if __name__ == '__main__':
    main()
