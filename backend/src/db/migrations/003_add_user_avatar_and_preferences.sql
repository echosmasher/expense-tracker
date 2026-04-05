-- 003_add_user_avatar_and_preferences.sql
-- Adds avatar storage key and JSON preferences to users table.

ALTER TABLE users ADD COLUMN avatar_key TEXT;

-- Preferences stored as JSONB with defaults handled in application code.
-- Keys: theme ('light'|'dark'), notify_new_expense (bool), notify_settlement (bool), notify_invite (bool)
ALTER TABLE users ADD COLUMN preferences JSONB NOT NULL DEFAULT '{}';
