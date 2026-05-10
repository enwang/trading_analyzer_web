CREATE TABLE IF NOT EXISTS trade_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual',
  trade_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trade_snapshots_user_created
ON trade_snapshots(user_id, created_at DESC);

ALTER TABLE trade_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_trade_snapshots"
ON trade_snapshots
FOR ALL
USING (auth.uid() = user_id);
