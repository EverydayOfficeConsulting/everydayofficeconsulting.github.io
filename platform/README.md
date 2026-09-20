# EOCO Tools — tools.eoco.ca

One website, one database (Supabase), one admin login for every tool.

```
index.html              public tools page (lists every tool)
config.js               Supabase URL + anon key (shared by every page)
admin/index.html        MAIN ADMIN: overview, tools page, admins, complete backup
platform/tools.js       THE TOOL LIST — every tool is registered here
platform/admin-common.js  shared admin code: sign-in, dropdown, generic backup/restore
platform/admin.css      shared admin styles
setup/00-platform.sql   database: admins, tool_settings, tool_secrets, tool_events
setup/<tool>.sql        database: each tool's own tables
roadmap/                Foundational Roadmap (index.html + admin.html)
newcalculator/          Real Cost Calculator (index.html + admin.html)
```

## Adding a tool

1. Create a folder, e.g. `mytool/`, with:
   - `index.html` for visitors. Load `../config.js` and read settings with
     `sb.from('tool_settings').select('settings').eq('tool_id', 'mytool')`.
     Log anonymous activity with `sb.from('tool_events').insert({ tool_id: 'mytool', event: 'something' })`.
   - `admin.html` for admins. Copy `newcalculator/admin.html` as a starting point: it loads
     `../config.js`, `../platform/tools.js`, `../platform/admin-common.js` and `../platform/admin.css`,
     then calls `EOCO.mountSwitcher('mytool')` and `EOCO.auth({ onReady })`.
2. If it needs its own tables, write `setup/mytool.sql`. It must be safe to run more than once
   (`create table if not exists`, `drop policy if exists` …) and use `public.is_admin()` for write access.
   Simple tools can skip this and keep everything in `tool_settings` (one row per tool) and
   `tool_secrets` (admin-only values such as access codes).
3. Add one entry to `platform/tools.js` with its `id`, `name`, `icon`, `summary`, `path`, `admin`,
   `setupSql`, and the `backup` tables in restore order (`key` = unique column, `where` = limit a
   shared table to this tool's rows).

That's it: the tool then appears on the tools page, in every admin dropdown, in the main admin
overview, and in the complete backup, content SQL and rebuild guide — no backup code changes.

## Database updates for an existing project

Each `setup/*.sql` file is idempotent, so re-running `00-platform.sql` and then a tool's file is
always safe. The main admin's "Download complete kit" combines all of them, in tool-list order,
into `1-database-setup.sql`.
