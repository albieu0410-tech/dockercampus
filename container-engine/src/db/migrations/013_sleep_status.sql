DO $$
BEGIN
    ALTER TYPE container_status ADD VALUE IF NOT EXISTS 'sleeping';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;
