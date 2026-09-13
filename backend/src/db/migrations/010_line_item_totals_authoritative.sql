-- Ticket 12 (spec 005): line_items.total_price_ore becomes the stored,
-- authoritative home-currency line total. Backfill is byte-identical to the
-- arithmetic every code path already used on read (unit_price_ore * quantity);
-- no existing value is overwritten, only nulls are filled.
UPDATE line_items SET total_price_ore = unit_price_ore * quantity WHERE total_price_ore IS NULL;
ALTER TABLE line_items ALTER COLUMN total_price_ore SET NOT NULL;
