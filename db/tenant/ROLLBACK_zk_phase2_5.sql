-- Rolls back ONLY the additive zero-knowledge objects (SQL 10, 11, 12, 13). Run on production only if the cutover is abandoned
-- BEFORE the plaintext tables are dropped. It removes encrypted copies and keys, never the original plaintext tables.
-- If step 3 (data migration) already happened, the plaintext is still there (step 7 not done), so nothing is lost.
-- NOT covered here: the full rollback to the pre-Tier-3 state ("rollback" = reset main to restore/pre-tier3-2026-11-18 and
-- restore tables from schema rollback_20261118). This script is the surgical option.
drop trigger if exists audit_user_keys on public.user_keys;
drop trigger if exists audit_enc_rows on public.enc_rows;
drop trigger if exists audit_broker_secrets on public.broker_secrets;
drop function if exists public.audit_privileged();
-- keep the audit trail itself if it already recorded anything worth reviewing; drop it only when you are sure:
-- drop table if exists public.audit_log; drop function if exists public.audit_log_immutable();
drop table if exists public.enc_rows;
drop table if exists public.market_cache;
drop function if exists public.zk_login_params(text);
drop table if exists public.user_keys;
delete from vault.secrets where name = 'zk_salt_pepper';
