# Sincronia — ServiceNow-side Source

Source for the global-scope ServiceNow records that back the Sincronia REST API
(`@tenonhq/sincronia-core` calls into these). These records aren't synced via
Sincronia itself because `sinc.config.js` doesn't include the global scope —
this directory is the source of truth and changes are pushed via the
`scripts/deploy.js` helper.

## Layout

```
servicenow/
├── sys_script_include/
│   ├── SincUtils.js       global.SincUtils — entry-point class
│   └── SincUtilsMS.js     global.SincUtilsMS — base class with all logic
├── sys_ws_operation/
│   ├── getAppList.js      GET  /api/sinc/sincronia/getAppList
│   ├── getCurrentScope.js GET  /api/sinc/sincronia/getCurrentScope
│   ├── getManifest.js     POST /api/sinc/sincronia/getManifest/{scope}
│   ├── bulkDownload.js    POST /api/sinc/sincronia/bulkDownload
│   └── pushATFfile.js     POST /api/sinc/sincronia/pushATFfile
└── scripts/
    └── deploy.js          push local source → ServiceNow instance
```

## Web Service Definition

- Name: **Sincronia**
- Scope: **global**
- sys_id: `afaa2facc30cc710d4ddf1db050131b0`
- namespace: `sinc`, service_id: `sincronia`
- Base URL: `https://<instance>/api/sinc/sincronia/`

This shadows the upstream NuvolaTech `x_nuvo_sinc` REST API at the same URL
(only one `sys_ws_definition` can claim a given `namespace/service_id` pair),
so any client hitting `/api/sinc/sincronia/...` reaches this Tenon-owned
implementation regardless of which app is installed.

## Deployment

```sh
node scripts/deploy.js              # push all files
node scripts/deploy.js --dry-run    # show diff without writing
node scripts/deploy.js SincUtilsMS  # push a specific record
```

Set `SN_INSTANCE`, `SN_USER`, `SN_PASSWORD` in env or `.env` (same as the
ServiceNow repo). All edits are captured in whatever update set the user has
active; the deploy script does not switch update sets.

## Why this folder exists

These records started life on NuvolaTech's `x_nuvo_sinc` plugin. Tenon ported
them to global scope on 2026-04-01 to own the API surface, but the source was
exported as ad-hoc XML to `Downloads/` rather than checked in — making changes
unreviewable. This directory is the canonical source going forward.
