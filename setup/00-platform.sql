-- =====================================================================
-- EOCO Tools — PLATFORM (shared by every tool)
-- Admins, the admin check, shared tool settings, access codes and
-- activity logging. Always runs FIRST, before any tool's own setup.
-- Safe to run more than once.
-- =====================================================================

-- keeps updated_at current on every edit (used by many tables)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- ADMINS  (one list for the whole site: every admin can use every tool)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- >>> the admin email <<<
insert into public.admins (email) values ('you@example.com')
on conflict do nothing;

alter table public.admins enable row level security;

drop policy if exists "admins see admins" on public.admins;
create policy "admins see admins" on public.admins
  for select to authenticated using (public.is_admin());

drop policy if exists "admins add admins" on public.admins;
create policy "admins add admins" on public.admins
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admins remove admins" on public.admins;
create policy "admins remove admins" on public.admins
  for delete to authenticated
  using (public.is_admin() and lower(email) <> lower(coalesce(auth.jwt() ->> 'email', '')));

-- ---------------------------------------------------------------------
-- TOOL SETTINGS  (one row per tool, plus 'hub' for the tools home page)
-- Everyone can read these: they only hold what visitors see anyway.
-- ---------------------------------------------------------------------
create table if not exists public.tool_settings (
  tool_id    text primary key,
  settings   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.tool_settings (tool_id) values ('hub') on conflict (tool_id) do nothing;

drop trigger if exists tool_settings_touch on public.tool_settings;
create trigger tool_settings_touch before update on public.tool_settings
for each row execute function public.touch_updated_at();

alter table public.tool_settings enable row level security;

drop policy if exists "tool settings readable by everyone" on public.tool_settings;
create policy "tool settings readable by everyone" on public.tool_settings
  for select using (true);

drop policy if exists "admins manage tool settings" on public.tool_settings;
create policy "admins manage tool settings" on public.tool_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- TOOL SECRETS  (e.g. access codes). Only admins can read them;
-- visitors can only ask "is this code right?".
-- ---------------------------------------------------------------------
create table if not exists public.tool_secrets (
  tool_id     text primary key,
  access_code text        not null default '',
  updated_at  timestamptz not null default now()
);

drop trigger if exists tool_secrets_touch on public.tool_secrets;
create trigger tool_secrets_touch before update on public.tool_secrets
for each row execute function public.touch_updated_at();

alter table public.tool_secrets enable row level security;

drop policy if exists "admins manage tool secrets" on public.tool_secrets;
create policy "admins manage tool secrets" on public.tool_secrets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.verify_access_code(p_tool text, p_code text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare ok boolean;
begin
  perform pg_sleep(0.4);   -- slows down anyone trying to guess
  select coalesce(access_code <> '' and access_code = p_code, false) into ok
  from public.tool_secrets where tool_id = p_tool;
  return coalesce(ok, false);
end $$;

grant execute on function public.verify_access_code(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- TOOL EVENTS  (anonymous activity counts, e.g. "PDF downloaded")
-- ---------------------------------------------------------------------
create table if not exists public.tool_events (
  id         bigint generated always as identity primary key,
  tool_id    text        not null check (char_length(tool_id) between 1 and 40),
  event      text        not null check (char_length(event) between 1 and 40),
  created_at timestamptz not null default now()
);

create index if not exists tool_events_tool_time_idx on public.tool_events (tool_id, created_at);

alter table public.tool_events enable row level security;

drop policy if exists "anyone can log tool events" on public.tool_events;
create policy "anyone can log tool events" on public.tool_events
  for insert to anon, authenticated
  with check (char_length(tool_id) between 1 and 40 and char_length(event) between 1 and 40);

drop policy if exists "admins read tool events" on public.tool_events;
create policy "admins read tool events" on public.tool_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admins delete tool events" on public.tool_events;
create policy "admins delete tool events" on public.tool_events
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- ACCOUNT LIST  (for the main admin and the rebuild kit; admins only)
-- ---------------------------------------------------------------------
create or replace function public.admin_user_list()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can list accounts';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(u) order by u.created_at desc) from (
      select email, created_at, last_sign_in_at
      from auth.users order by created_at desc limit 2000
    ) u), '[]'::jsonb);
end $$;

revoke all on function public.admin_user_list() from public, anon;
grant execute on function public.admin_user_list() to authenticated;
