CREATE TABLE IF NOT EXISTS classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    professor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(class_id, user_id)
);

ALTER TABLE invite_codes
    ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id);

ALTER TABLE containers
    ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_classes_professor
    ON classes(professor_id);

CREATE INDEX IF NOT EXISTS idx_memberships_class
    ON class_memberships(class_id);

CREATE INDEX IF NOT EXISTS idx_memberships_user
    ON class_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_containers_last_activity
    ON containers(last_activity);
