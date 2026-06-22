-- AUD-002 runtime RLS validation — repeatable.
-- Run against a DB provisioned per audit/evidence/README; expects two seeded
-- tenants (A=aaaa…0001, B=bbbb…0002) with 2 + 1 projects.
-- As OWNER (jarvis): RLS bypassed (vuln). As jarvis_app (NOBYPASSRLS): enforced.
\echo '== owner sees all (bypass) =='
SELECT count(*) AS owner_sees FROM projects;          -- expect 3
\echo '== app role, tenant A =='
BEGIN; SELECT set_config('app.current_tenant_id','aaaaaaaa-0000-0000-0000-000000000001',true);
SELECT count(*) AS sees_a FROM projects; COMMIT;        -- expect 2
\echo '== app role, tenant B =='
BEGIN; SELECT set_config('app.current_tenant_id','bbbbbbbb-0000-0000-0000-000000000002',true);
SELECT count(*) AS sees_b FROM projects; COMMIT;        -- expect 1
\echo '== app role, no context (fail-closed) =='
SELECT count(*) AS sees_none FROM projects;            -- expect 0
