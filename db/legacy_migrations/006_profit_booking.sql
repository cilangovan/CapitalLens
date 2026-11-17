-- Profit booking dashboard (applied 2026-11-16)
alter table positions add column if not exists quantity numeric;
-- profit_booking, profit_booking_summary: see Supabase migration "profit_booking"
