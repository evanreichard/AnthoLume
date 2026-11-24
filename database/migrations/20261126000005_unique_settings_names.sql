-- +goose Up
DELETE FROM settings WHERE id NOT IN (SELECT MAX(id) FROM settings GROUP BY name);
CREATE UNIQUE INDEX settings_name_unique ON settings(name);

-- +goose Down
DROP INDEX settings_name_unique;
