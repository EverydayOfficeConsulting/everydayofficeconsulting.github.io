-- =====================================================================
-- EOCO Tools — FOUNDATIONAL ROADMAP
-- Tables: modules, phases, site_settings (appearance), profiles and
-- user_progress (visitors' own data). Needs 00-platform.sql first.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MODULES  (replaces the Google Sheet)
-- One row per module. Steps and the Links & Tools library are stored as
-- JSON so a module can be created, edited or duplicated as a single row.
--
-- steps   = [ { "id": "s_ab12cd", "name": "Open a bank account",
--               "content": "<p>HTML allowed</p>", "tags": ["NS","QBO"] } ]
-- library = [ { "title": "Banks",
--               "items": [ { "name": "RBC", "url": "https://...", "tags": [] } ] } ]
-- tags    = [ "NS", "PLUMBER", "QBO" ]   (same tags you used in {braces})
-- ---------------------------------------------------------------------
create table if not exists public.modules (
  id          text primary key,
  sort_order  integer     not null default 0,
  phase       text        not null default 'PHASE 1',
  title       text        not null,
  tags        jsonb       not null default '[]'::jsonb,
  description text        not null default '',
  video       text        not null default '',
  steps       jsonb       not null default '[]'::jsonb,
  library     jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists modules_sort_idx on public.modules (sort_order);

drop trigger if exists modules_touch on public.modules;
create trigger modules_touch before update on public.modules
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. PROFILES  (replaces localStorage "eoco_profile")
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  province   text not null default 'CAN',
  industry   text not null default 'ALL',
  software   text not null default 'ALL',
  yearend    text not null default '12',
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. PROGRESS  (replaces localStorage "eoco_state")
-- One row per checked step. Uses the step's stable id, so reordering
-- steps in the admin dashboard never scrambles anyone's checkmarks.
-- ---------------------------------------------------------------------
create table if not exists public.user_progress (
  user_id      uuid not null references auth.users (id) on delete cascade,
  module_id    text not null references public.modules (id) on delete cascade on update cascade,
  step_id      text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, module_id, step_id)
);

-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.modules       enable row level security;
alter table public.profiles      enable row level security;
alter table public.user_progress enable row level security;

-- modules: anyone can read, only admins can change
drop policy if exists "modules readable by everyone" on public.modules;
create policy "modules readable by everyone" on public.modules
  for select using (true);

drop policy if exists "admins insert modules" on public.modules;
create policy "admins insert modules" on public.modules
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admins update modules" on public.modules;
create policy "admins update modules" on public.modules
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete modules" on public.modules;
create policy "admins delete modules" on public.modules
  for delete to authenticated using (public.is_admin());

-- profiles: each user sees and edits only their own row
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- progress: each user sees and edits only their own checkmarks
drop policy if exists "own progress" on public.user_progress;
create policy "own progress" on public.user_progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- PHASES, HIDE/SHOW, APPEARANCE, INSIGHTS
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. PHASES  (their own table so they can be added, renamed, reordered
--    and removed from the admin dashboard)
-- ---------------------------------------------------------------------
create table if not exists public.phases (
  name       text primary key,
  sort_order integer     not null default 0,
  subtitle   text        not null default '',
  created_at timestamptz not null default now()
);

-- create a phase for every phase your modules already use, in the
-- order they currently appear
insert into public.phases (name, sort_order)
select phase, (row_number() over (order by min(sort_order))) * 10
from public.modules
group by phase
on conflict (name) do nothing;

-- every module must belong to a real phase. Renaming a phase renames it
-- on all its modules automatically; a phase that still has modules
-- can't be deleted by accident.
alter table public.modules alter column phase drop default;
alter table public.modules drop constraint if exists modules_phase_fkey;
alter table public.modules
  add constraint modules_phase_fkey foreign key (phase)
  references public.phases (name) on update cascade on delete restrict;

alter table public.phases enable row level security;

drop policy if exists "phases readable by everyone" on public.phases;
create policy "phases readable by everyone" on public.phases
  for select using (true);

drop policy if exists "admins manage phases" on public.phases;
create policy "admins manage phases" on public.phases
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 2. HIDE / SHOW MODULES  (hidden modules are only visible to admins,
--    so you can work on drafts before they go live)
-- ---------------------------------------------------------------------
alter table public.modules add column if not exists published boolean not null default true;

drop policy if exists "modules readable by everyone" on public.modules;
create policy "modules readable by everyone" on public.modules
  for select using (published or public.is_admin());

-- ---------------------------------------------------------------------
-- 3. SITE SETTINGS  (one row holding colours, fonts, sizes, header
--    text and the announcement banner)
-- ---------------------------------------------------------------------
create table if not exists public.site_settings (
  id         integer primary key default 1 check (id = 1),
  settings   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch before update on public.site_settings
for each row execute function public.touch_updated_at();

alter table public.site_settings enable row level security;

drop policy if exists "settings readable by everyone" on public.site_settings;
create policy "settings readable by everyone" on public.site_settings
  for select using (true);

drop policy if exists "admins manage settings" on public.site_settings;
create policy "admins manage settings" on public.site_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 4. INSIGHTS  (numbers for the admin Insights tab; admins only)
-- ---------------------------------------------------------------------
create or replace function public.admin_insights()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can view insights';
  end if;

  select jsonb_build_object(
    'total_users',     (select count(*) from auth.users),
    'new_users_30d',   (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_users_7d', (select count(distinct user_id) from public.user_progress
                         where completed_at > now() - interval '7 days'),
    'total_checks',    (select count(*) from public.user_progress),
    'by_province', coalesce((select jsonb_object_agg(k, n) from
                     (select province as k, count(*) as n from public.profiles group by province) x), '{}'::jsonb),
    'by_industry', coalesce((select jsonb_object_agg(k, n) from
                     (select industry as k, count(*) as n from public.profiles group by industry) x), '{}'::jsonb),
    'by_software', coalesce((select jsonb_object_agg(k, n) from
                     (select software as k, count(*) as n from public.profiles group by software) x), '{}'::jsonb),
    'module_users', coalesce((select jsonb_object_agg(module_id, n) from
                     (select module_id, count(distinct user_id) as n from public.user_progress group by module_id) x), '{}'::jsonb),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('module_id', module_id, 'step_id', step_id, 'n', n)) from
                     (select module_id, step_id, count(*) as n from public.user_progress group by module_id, step_id) x), '[]'::jsonb),
    'recent_users', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at desc) from (
                     select au.email, au.created_at, au.last_sign_in_at,
                            p.province, p.industry, p.software,
                            (select count(*) from public.user_progress up where up.user_id = au.id) as steps_done
                     from auth.users au
                     left join public.profiles p on p.user_id = au.id
                     order by au.created_at desc
                     limit 200) u), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke all on function public.admin_insights() from public, anon;
grant execute on function public.admin_insights() to authenticated;
