#!/usr/bin/env python3
"""Show what the BuyZone n8n workflows actually did: latest executions, the failing node and its
error, and the Ingest node's response. Read-only. Same env file and tunnel as deploy.py.

  python3 n8n/diagnose.py                 # last 3 executions of every "BuyZone — " workflow
  python3 n8n/diagnose.py --limit 5 --workflow Swing
Options: --env FILE   --no-tunnel   --base-url URL   --local-port N
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deploy import Api, PREFIX, ROOT, Tunnel, load_env  # noqa: E402

INTERESTING = ('Get Assets', 'Split Assets', 'Ingest', 'Split Alerts', 'ntfy Push')


def log(msg=''):
    print(msg, flush=True)


def short(v, n=300):
    s = v if isinstance(v, str) else json.dumps(v, default=str)
    return s if len(s) <= n else s[:n] + '…'


def describe_execution(api, ex):
    eid = ex['id']
    log(f'  execution {eid}: status={ex.get("status")} mode={ex.get("mode")} started={ex.get("startedAt")} stopped={ex.get("stoppedAt")}')
    full = api.call('GET', f'/executions/{eid}?includeData=true')
    rd = ((full.get('data') or {}).get('resultData') or {})
    run = rd.get('runData') or {}
    err = rd.get('error')
    if err:
        node = (err.get('node') or {}).get('name') if isinstance(err.get('node'), dict) else err.get('node')
        log(f'    FAILED at node "{node or rd.get("lastNodeExecuted")}": {short(err.get("message"))}')
        if err.get('description'):
            log(f'      detail: {short(err["description"])}')
        if err.get('httpCode'):
            log(f'      httpCode: {err["httpCode"]}')
    else:
        log(f'    last node executed: {rd.get("lastNodeExecuted")}')
    for name, runs in run.items():
        for r in runs[-1:]:
            st = r.get('executionStatus') or ('error' if r.get('error') else 'success')
            items = 0
            try:
                items = sum(len(out or []) for out in (r.get('data') or {}).get('main', []))
            except Exception:
                pass
            line = f'    - {name}: {st}, {items} item(s)'
            if r.get('error'):
                e = r['error']
                line += f' — {short(e.get("message"))}' + (f' [{e.get("httpCode")}]' if e.get('httpCode') else '')
            log(line)
            if name in INTERESTING and st != 'error':
                try:
                    first = ((r.get('data') or {}).get('main') or [[]])[0]
                    if first:
                        j = first[0].get('json', {})
                        j = j.get('body', j) if isinstance(j, dict) else j
                        if name == 'Ingest' and isinstance(j, dict):
                            log(f'      ingest response: ok={j.get("ok")} stored={j.get("stored")} alerts={j.get("alert_count")}' + (f' error={short(j.get("error"))}' if j.get('error') else ''))
                        elif name == 'Get Assets' and isinstance(j, dict):
                            log(f'      assets: {[a.get("symbol") for a in j.get("assets", [])]}')
                        elif name in ('Split Assets', 'Split Alerts'):
                            log(f'      first item: {short(j, 160)}')
                except Exception as e:  # diagnostics must never crash on an odd shape
                    log(f'      (could not read output: {e})')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--env', default=os.path.join(ROOT, 'deploy.env'))
    ap.add_argument('--no-tunnel', action='store_true')
    ap.add_argument('--base-url')
    ap.add_argument('--local-port', type=int, default=15678)
    ap.add_argument('--limit', type=int, default=3)
    ap.add_argument('--workflow', help='only workflows whose name contains this text')
    args = ap.parse_args()
    env = {**load_env(args.env), **{k: v for k, v in os.environ.items() if k in ('N8N_SSH', 'N8N_API_KEY')}}
    if not env.get('N8N_API_KEY'):
        sys.exit(f'N8N_API_KEY is not set (see {args.env})')
    base = args.base_url or (f'http://127.0.0.1:{args.local_port}' if not args.no_tunnel else 'http://127.0.0.1:5678')

    def run():
        api = Api(base, env['N8N_API_KEY'])
        wfs = [w for w in api.list_workflows() if w['name'].startswith(PREFIX) and (not args.workflow or args.workflow.lower() in w['name'].lower())]
        if not wfs:
            log('no BuyZone workflows found on the instance')
            return
        for w in wfs:
            full = api.call('GET', f'/workflows/{w["id"]}')
            ver, live = full.get('versionId'), full.get('activeVersionId')
            pub = '' if live is None else (' · published' if live == ver else ' · DRAFT NOT PUBLISHED')
            log(f'{w["name"]} (id {w["id"]}): {"active" if full.get("active") else "NOT ACTIVE"}{pub}')
            exs = api.call('GET', f'/executions?workflowId={w["id"]}&limit={args.limit}').get('data', [])
            if not exs:
                log('  no executions yet')
            for ex in exs:
                describe_execution(api, ex)
            log()

    if args.no_tunnel:
        run()
    else:
        with Tunnel(env.get('N8N_SSH', 'john@76.13.110.193'), args.local_port):
            run()


if __name__ == '__main__':
    main()
