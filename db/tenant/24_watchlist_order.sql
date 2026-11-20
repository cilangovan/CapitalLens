-- Watchlist card order, remembered per user.
-- sort_order = 0-based place of the card inside its category (stock / commodity / crypto); NULL = automatic (by this week's call).
-- Legacy (plaintext) dashboard only: in the zero-knowledge app the same field lives inside the user's encrypted watchlist row (docs/zk/shim.js),
-- so the server never sees which tickers a user watches or in what order.
alter table public.watchlist add column if not exists sort_order integer;
alter table public.watchlist drop constraint if exists watchlist_sort_order_check;
alter table public.watchlist add constraint watchlist_sort_order_check check (sort_order is null or (sort_order >= 0 and sort_order < 500));
