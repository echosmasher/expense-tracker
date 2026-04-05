-- Reconciles settlements and settlement_balances with the application code.
-- The code writes/reads `allocation_key_snapshot_id` and `balance_ore`, while
-- migration 001 named those columns `allocation_key_id` and `amount_ore`.

ALTER TABLE settlements         RENAME COLUMN allocation_key_id TO allocation_key_snapshot_id;
ALTER TABLE settlement_balances RENAME COLUMN amount_ore        TO balance_ore;
