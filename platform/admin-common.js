/* =====================================================================
   EOCO Tools — shared admin code
   Used by the main admin and every tool's admin page: sign-in, the
   tool dropdown, dialogs, and the generic backup / restore that works
   for any tool listed in platform/tools.js.
   ===================================================================== */
window.EOCO = (function () {
  const cfg = window.EOCO_CONFIG || {};
  const ROOT = window.EOCO_ROOT || '../';
  const PLATFORM = window.EOCO_PLATFORM || { backup: [] };
  const TOOLS = window.EOCO_TOOLS || [];
  const $ = id => document.getElementById(id);
  let client = null;

  const E = { cfg, root: ROOT, platform: PLATFORM, tools: TOOLS };

  /* ---------- basics ---------- */
  E.url = p => ROOT + p;
  E.client = () => client || (client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY));
  E.configured = () => !!cfg.SUPABASE_URL && !String(cfg.SUPABASE_URL).includes('YOUR-PROJECT');
  E.tool = id => TOOLS.find(t => t.id === id);
  E.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  E.plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  E.clone = o => JSON.parse(JSON.stringify(o));
  E.day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  E.timeAgo = iso => {
    if (!iso) return '—';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return E.plural(Math.floor(s / 60), 'minute') + ' ago';
    if (s < 86400) return E.plural(Math.floor(s / 3600), 'hour') + ' ago';
    if (s < 86400 * 30) return E.plural(Math.floor(s / 86400), 'day') + ' ago';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  E.merge = function merge(base, over) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    if (!over || typeof over !== 'object') return out;
    Object.keys(over).forEach(k => {
      const b = base ? base[k] : undefined, o = over[k];
      if (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, o);
      else if (o !== undefined && o !== null) out[k] = o;
    });
    return out;
  };

  E.toast = (msg, isError) => {
    const t = $('toast'); if (!t) return alert(msg);
    t.textContent = msg; t.classList.toggle('error', !!isError); t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2400);
  };

  E.ask = ({ title, text, ok = 'Delete', danger = true, extra = '', wide = false }) => new Promise(resolve => {
    const dlg = $('confirm');
    dlg.classList.toggle('wide', wide);
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-extra').innerHTML = extra;
    $('confirm-ok').textContent = ok;
    $('confirm-ok').className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    const done = v => { dlg.close(); resolve(v); };
    $('confirm-ok').onclick = () => done(true);
    $('confirm-cancel').onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal();
    $('confirm-cancel').focus();
  });

  E.downloadFile = (name, content, type) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  E.toCSV = (rows, cols) => {
    cols = cols || [...new Set(rows.flatMap(r => Object.keys(r)))];
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c] !== null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])).join(','))].join('\n') + '\n';
  };

  E.fetchText = async path => {
    try {
      const r = await fetch(path + (path.includes('?') ? '&' : '?') + 'v=' + Date.now(), { cache: 'no-store' });
      return r.ok ? await r.text() : null;
    } catch { return null; }
  };

  E.loadScript = src => new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src.split('/').pop() + '. Check your internet connection.'));
    document.head.appendChild(s);
  });

  /* ---------- the admin dropdown ---------- */
  E.mountSwitcher = currentId => {
    const box = $('tool-switcher'); if (!box) return;
    const opts = [{ id: 'main', label: '🏠 Main admin (all tools)', href: E.url('admin/') }]
      .concat(TOOLS.map(t => ({ id: t.id, label: `${t.icon || '•'} ${t.name}`, href: E.url(t.admin) })));
    box.innerHTML = `<select aria-label="Switch admin section">${opts.map(o =>
      `<option value="${E.esc(o.href)}" ${o.id === currentId ? 'selected' : ''}>${E.esc(o.label)}</option>`).join('')}</select>`;
    box.querySelector('select').onchange = e => { location.href = e.target.value; };
  };

  /* ---------- sign-in gate (main admin + tool admins built on this) ---------- */
  E.auth = async ({ onReady, beforeSignOut }) => {
    const sb = E.client();
    const showGate = message => {
      document.querySelectorAll('[data-app]').forEach(el => el.hidden = true);
      $('gate').hidden = false; $('signout-btn').hidden = true; $('who').textContent = '';
      $('login-error').hidden = !message; $('login-error').textContent = message || '';
    };
    const enter = async session => {
      const { data: isAdmin, error } = await sb.rpc('is_admin');
      if (error || !isAdmin) {
        await sb.auth.signOut();
        showGate(error ? `Couldn't check admin access: ${error.message}` : `${session.user.email} isn't an admin. Add this email to the admins list.`);
        return;
      }
      $('gate').hidden = true; $('signout-btn').hidden = false;
      document.querySelectorAll('[data-app]').forEach(el => el.hidden = false);
      $('who').textContent = session.user.email;
      E.session = session;
      onReady(session);
    };
    $('login-btn').onclick = async () => {
      const email = $('login-email').value.trim(), password = $('login-pass').value;
      if (!email || !password) { showGate('Enter your email and password.'); return; }
      $('login-btn').disabled = true; $('login-btn').textContent = 'Signing in…';
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      $('login-btn').disabled = false; $('login-btn').textContent = 'Sign in';
      if (error) { showGate(error.message); return; }
      enter(data.session);
    };
    $('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-btn').click(); });
    $('signout-btn').onclick = async () => {
      if (beforeSignOut && beforeSignOut() === false) return;
      await sb.auth.signOut(); location.hash = ''; showGate();
    };
    if (!E.configured()) { showGate('The Supabase connection codes are missing from config.js.'); $('login-btn').disabled = true; return; }
    const { data: { session } } = await sb.auth.getSession();
    session ? enter(session) : showGate();
  };

  /* ---------- admin light/dark ---------- */
  E.themeButton = () => {
    const btn = $('theme-btn'); if (!btn) return;
    const apply = t => { document.body.setAttribute('data-theme', t); btn.textContent = t === 'light' ? 'Dark mode' : 'Light mode'; };
    apply(localStorage.getItem('eoco_theme') || 'light');
    btn.onclick = () => { const n = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; localStorage.setItem('eoco_theme', n); apply(n); };
  };

  /* =====================================================================
     GENERIC BACKUP — works for any tool in platform/tools.js
     ===================================================================== */
  const matchesWhere = (row, where) => !where || Object.keys(where).every(k => row[k] === where[k]);

  E.exportTable = async def => {
    const sb = E.client(), rows = [], page = 1000;
    for (let from = 0; ; from += page) {
      let q = sb.from(def.table).select('*');
      Object.entries(def.where || {}).forEach(([k, v]) => { q = q.eq(k, v); });
      const { data, error } = await q.order(def.key).range(from, from + page - 1);
      if (error) throw new Error(`${def.table}: ${error.message}`);
      rows.push(...(data || []));
      if (!data || data.length < page) break;
    }
    return rows;
  };

  E.exportDefs = async defs => {
    const tables = {}, errors = [];
    for (const def of defs) {
      try { tables[def.table] = await E.exportTable(def); }
      catch (err) { errors.push(err.message); }
    }
    return { tables, errors };
  };

  // one tool's content, as its own backup file
  E.exportTool = async toolId => {
    const t = E.tool(toolId);
    const { tables, errors } = await E.exportDefs(t.backup || []);
    return { app: 'eoco-tools', version: 3, kind: 'tool', tool: t.id, tool_name: t.name, exported_at: new Date().toISOString(), tables, errors };
  };

  // everything: the platform + every tool in the list
  E.exportAll = async () => {
    const out = { app: 'eoco-tools', version: 3, kind: 'full', exported_at: new Date().toISOString(), platform: { tables: {} }, tools: {}, errors: [] };
    const p = await E.exportDefs(PLATFORM.backup || []);
    out.platform.tables = p.tables; out.errors.push(...p.errors);
    for (const t of TOOLS) {
      const r = await E.exportDefs(t.backup || []);
      out.tools[t.id] = { name: t.name, tables: r.tables };
      out.errors.push(...r.errors);
    }
    return out;
  };

  // find one tool's tables in either a full backup or that tool's own file
  E.toolSection = (data, toolId) => {
    if (!data || data.app !== 'eoco-tools') return null;
    if (data.kind === 'tool') return data.tool === toolId ? data.tables : null;
    return data.tools && data.tools[toolId] ? data.tools[toolId].tables : null;
  };

  E.restoreDefs = async (defs, tables) => {
    const sb = E.client(); let count = 0;
    for (const def of defs) {
      const rows = (tables[def.table] || []).filter(r => matchesWhere(r, def.where));
      if (!rows.length) continue;
      const { error } = await sb.from(def.table).upsert(rows, { onConflict: def.key });
      if (error) throw new Error(`${def.table}: ${error.message}`);
      count += rows.length;
    }
    return count;
  };

  E.restoreTool = async (toolId, data) => {
    const tables = E.toolSection(data, toolId);
    if (!tables) throw new Error(`that file has no ${E.tool(toolId).name} content`);
    return E.restoreDefs(E.tool(toolId).backup || [], tables);
  };

  E.restoreAll = async data => {
    if (!data || data.app !== 'eoco-tools' || data.kind !== 'full') throw new Error("that isn't a full EOCO Tools backup");
    let n = await E.restoreDefs(PLATFORM.backup || [], (data.platform && data.platform.tables) || {});
    for (const t of TOOLS) if (data.tools && data.tools[t.id]) n += await E.restoreDefs(t.backup || [], data.tools[t.id].tables || {});
    return n;
  };

  // SQL that puts every table's rows back (used in the rebuild kit)
  E.contentSQL = (full, stamp) => {
    const lit = v => "'" + String(v).replace(/'/g, "''") + "'";
    const id = c => '"' + String(c).replace(/"/g, '""') + '"';
    const block = (def, rows, owner) => {
      rows = (rows || []).filter(r => matchesWhere(r, def.where));
      if (!rows.length) return `-- ${owner}: ${def.label || def.table} — nothing to restore\n`;
      const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
      const list = cols.map(id).join(', ');
      const upd = cols.filter(c => c !== def.key).map(c => `${id(c)} = excluded.${id(c)}`).join(', ');
      return `-- ${owner}: ${def.label || def.table} (${E.plural(rows.length, 'row')})
insert into public.${def.table} (${list})
select ${list} from jsonb_populate_recordset(null::public.${def.table}, ${lit(JSON.stringify(rows))}::jsonb)
on conflict (${id(def.key)}) do ${upd ? 'update set ' + upd : 'nothing'};
`;
    };
    const parts = [`-- =====================================================================
-- EOCO Tools — 2. YOUR CONTENT (snapshot from ${stamp})
-- Every tool's content, the tools page settings and the admin list.
-- Run AFTER 1-database-setup.sql:
--   Supabase → SQL Editor → New query → paste all → Run
-- Safe to run more than once: rows with the same key are replaced with
-- the version in this file, and nothing else is deleted.
-- =====================================================================

begin;
`];
    (PLATFORM.backup || []).forEach(def => parts.push(block(def, full.platform.tables[def.table], 'Platform')));
    TOOLS.forEach(t => (t.backup || []).forEach(def => parts.push(block(def, ((full.tools[t.id] || {}).tables || {})[def.table], t.name))));
    parts.push('commit;\n');
    return parts.join('\n');
  };

  // counts for overview cards
  E.countRows = async def => {
    let q = E.client().from(def.table).select('*', { count: 'exact', head: true });
    Object.entries(def.where || {}).forEach(([k, v]) => { q = q.eq(k, v); });
    const { count, error } = await q;
    return error ? null : count;
  };

  E.countEvents = async (toolId, event, sinceDays) => {
    let q = E.client().from('tool_events').select('*', { count: 'exact', head: true }).eq('tool_id', toolId);
    if (event) q = q.eq('event', event);
    if (sinceDays) q = q.gte('created_at', new Date(Date.now() - sinceDays * 86400000).toISOString());
    const { count, error } = await q;
    return error ? null : count;
  };

  return E;
})();
