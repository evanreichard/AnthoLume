CREATE TABLE IF NOT EXISTS reading_generation (
 singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton=1),
 generation TEXT NOT NULL CHECK (length(generation)=32 AND generation NOT GLOB '*[^0-9a-f]*')
 );
 INSERT INTO reading_generation VALUES (1,lower(hex(randomblob(16)))) ON CONFLICT(singleton) DO NOTHING;
