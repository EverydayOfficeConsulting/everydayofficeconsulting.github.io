-- =====================================================================
-- EOCO Tools — REAL COST CALCULATOR
-- Uses the shared platform tables: its settings live in tool_settings
-- (tool_id 'calculator') and its access code in tool_secrets.
-- Needs 00-platform.sql first. Safe to run more than once: existing
-- settings and codes are never overwritten.
-- =====================================================================

insert into public.tool_settings (tool_id, settings)
values ('calculator', '{}'::jsonb)
on conflict (tool_id) do nothing;

-- starting access code (the same one the old page used). Change it in
-- the calculator admin → Access tab.
insert into public.tool_secrets (tool_id, access_code)
values ('calculator', 'NovaScotia2026')
on conflict (tool_id) do nothing;
