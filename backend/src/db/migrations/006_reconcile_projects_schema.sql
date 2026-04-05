-- Reconciles the projects and project_members tables with the application code.
-- The projects creation flow mirrors households: code writes a
-- `current_allocation_key_id` (not in the original schema) and relies on
-- `allocation_key_id` being optional. project_members also needs a `role`.

-- ── projects ─────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN current_allocation_key_id UUID REFERENCES allocation_keys(id) ON DELETE SET NULL;

-- Code never populates the original allocation_key_id column; it uses
-- current_allocation_key_id instead.
ALTER TABLE projects ALTER COLUMN allocation_key_id DROP NOT NULL;

-- ── project_members ──────────────────────────────────────────────────────────

ALTER TABLE project_members
  ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member'));
