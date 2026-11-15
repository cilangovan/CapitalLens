-- Migration 004: PWI Scout Value Buy Scores
-- Run in Supabase SQL editor or via apply_migration

CREATE TABLE IF NOT EXISTS value_buy_scores (
  id               BIGSERIAL PRIMARY KEY,
  ticker           TEXT NOT NULL,
  display          TEXT,
  pie              TEXT,
  currency_symbol  TEXT DEFAULT '₹',
  score            INT,
  score_max        INT DEFAULT 100,
  verdict          TEXT,
  -- Entry zones: [{label, low, high, rating}]
  -- rating: "low" | "medium" | "high" (value opportunity)
  entry_zones      JSONB DEFAULT '[]',
  -- Scorecard: [{category, score, max}]
  scorecard        JSONB DEFAULT '[]',
  -- Earnings snapshot: {revenue_growth_pct, op_profit_growth_pct, net_profit_growth_pct, period}
  earnings         JSONB DEFAULT '{}',
  warning          TEXT,
  notes            TEXT,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS value_buy_scores_ticker_idx
  ON value_buy_scores(ticker);

ALTER TABLE value_buy_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON value_buy_scores
  FOR SELECT USING (true);
