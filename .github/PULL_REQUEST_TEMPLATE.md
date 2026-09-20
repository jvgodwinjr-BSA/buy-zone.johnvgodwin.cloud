## Summary

<!-- What changed and why. Link the decision in docs/decisions.md if one applies. -->

## Test plan

- [ ] `npm test` and `npm run check:n8n` pass
- [ ] PHP: `php -l` clean; pages checked locally or on the live site
- [ ] n8n change: re-deployed with `python3 n8n/deploy.py`, verified with `python3 n8n/diagnose.py`

## Context maintenance

- [ ] `docs/changelog.md` entry added (with any operator action: re-deploy, SQL import, config edit)
- [ ] `CLAUDE.md` updated if a rule, weight, schedule, id or hard stop changed
- [ ] `README.md` / `docs/*.md` updated if setup, operations or the data model changed
