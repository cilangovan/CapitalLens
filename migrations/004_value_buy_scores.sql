-- Migration 004: PWI Scout Value Buy Scores
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS value_buy_scores (
  id               BIGSERIAL PRIMARY KEY,
  ticker           TEXT NOT NULL,
  display          TEXT,
  pie              TEXT,
  currency_symbol  TEXT DEFAULT '$',
  score            INT,
  score_max        INT DEFAULT 100,
  verdict          TEXT,

  -- Entry zones: [{label, low, high, rating, note}]
  -- rating: "high" = strong buy / "medium" = accumulate / "low" = hold/wait
  entry_zones      JSONB DEFAULT '[]',

  -- Scorecard per category: [{category, score, max}]
  scorecard        JSONB DEFAULT '[]',

  -- Earnings snapshot (manual or fetched): {period, revenue_growth_pct, ...}
  earnings         JSONB DEFAULT '{}',

  -- This-week recommendation: {action, price, rationale, current, avg_cost, rsi, ma20, ma50, ...}
  this_week        JSONB DEFAULT '{}',

  warning          TEXT,
  notes            TEXT,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS value_buy_scores_ticker_idx
  ON value_buy_scores(ticker);

ALTER TABLE value_buy_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON value_buy_scores
  FOR SELECT USING (true);
