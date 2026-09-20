#!/usr/bin/env python3
"""Tiny stand-in for the n8n public API, used to exercise n8n/deploy.py without a real instance.

  python3 n8n/test/mock_n8n.py 15678
Seeds one legacy "BTC Buy-Zone Alerts" workflow (with an ntfy node) and one foreign "SecOps – X"
workflow. Rejects unknown top-level keys on workflow bodies the way n8n does, requires the
X-N8N-API-KEY "testkey", and records every request in /tmp/mock_n8n.log.
"""
import json
import sys
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

KEY = 'testkey'
ALLOWED_WF_KEYS = {'name', 'nodes', 'connections', 'settings', 'staticData'}
DB = {'workflows': {}, 'credentials': {}}


def seed():
    legacy = {'id': 'LEGACY1', 'name': 'BTC Buy-Zone Alerts (Crypto Lifer Framework)', 'active': True,
              'nodes': [{'name': 'ntfy Push', 'type': 'n8n-nodes-base.httpRequest', 'parameters': {'url': 'https://ntfy.example.org/btc-real',
                         'headerParameters': {'parameters': [{'name': 'Title', 'value': 'x'}]}}}], 'connections': {}, 'settings': {},
              'versionId': 'v-legacy', 'activeVersionId': 'v-legacy'}
    foreign = {'id': 'SECOPS1', 'name': 'SecOps – Alert triage', 'active': True, 'nodes': [], 'connections': {}, 'settings': {},
               'versionId': 'v1', 'activeVersionId': 'v1'}
    DB['workflows'] = {legacy['id']: legacy, foreign['id']: foreign}


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        with open('/tmp/mock_n8n.log', 'a') as f:
            f.write(f'{self.command} {self.path}\n')

    def send(self, code, body=None):
        data = b'' if body is None else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n)) if n else None

    def auth(self):
        if self.headers.get('X-N8N-API-KEY') != KEY:
            self.send(401, {'message': 'unauthorized'})
            return False
        return True

    def do_GET(self):
        if not self.auth():
            return
        p = self.path.split('?')[0]
        if p == '/api/v1/workflows':
            return self.send(200, {'data': [{k: w[k] for k in ('id', 'name', 'active')} for w in DB['workflows'].values()], 'nextCursor': None})
        if p.startswith('/api/v1/workflows/'):
            w = DB['workflows'].get(p.rsplit('/', 1)[1])
            return self.send(200, w) if w else self.send(404, {'message': 'not found'})
        self.send(404, {'message': 'not found'})

    def do_POST(self):
        if not self.auth():
            return
        p = self.path
        if p == '/api/v1/workflows':
            b = self.body()
            extra = set(b) - ALLOWED_WF_KEYS
            if extra:
                return self.send(400, {'message': f'request/body must NOT have additional properties: {sorted(extra)}'})
            wid = 'wf_' + uuid.uuid4().hex[:8]
            DB['workflows'][wid] = {**b, 'id': wid, 'active': False, 'versionId': 'v-' + uuid.uuid4().hex[:6], 'activeVersionId': None}
            return self.send(200, DB['workflows'][wid])
        if p == '/api/v1/credentials':
            b = self.body()
            cid = 'cred_' + uuid.uuid4().hex[:8]
            DB['credentials'][cid] = {**b, 'id': cid}
            return self.send(200, {'id': cid, 'name': b['name'], 'type': b['type']})
        if p.endswith('/activate') or p.endswith('/deactivate'):
            wid = p.split('/')[-2]
            w = DB['workflows'].get(wid)
            if not w:
                return self.send(404, {'message': 'not found'})
            w['active'] = p.endswith('/activate')
            if w['active']:
                w['activeVersionId'] = w['versionId']
            return self.send(200, w)
        self.send(404, {'message': 'not found'})

    def do_PUT(self):
        if not self.auth():
            return
        wid = self.path.rsplit('/', 1)[1]
        w = DB['workflows'].get(wid)
        if not w:
            return self.send(404, {'message': 'not found'})
        b = self.body()
        extra = set(b) - ALLOWED_WF_KEYS
        if extra:
            return self.send(400, {'message': f'request/body must NOT have additional properties: {sorted(extra)}'})
        if w['active']:
            return self.send(400, {'message': 'workflow is active; deactivate first'})
        w.update(b)
        w['versionId'] = 'v-' + uuid.uuid4().hex[:6]
        return self.send(200, w)


if __name__ == '__main__':
    seed()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 15678
    HTTPServer(('127.0.0.1', port), H).serve_forever()
