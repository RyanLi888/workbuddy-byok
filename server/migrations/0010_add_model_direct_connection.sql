ALTER TABLE model_configs
ADD COLUMN direct_connection INTEGER NOT NULL DEFAULT 0 CHECK(direct_connection IN (0, 1));
