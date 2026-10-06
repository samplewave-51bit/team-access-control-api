-- Create test database if it does not exist
SELECT 'CREATE DATABASE tac_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tac_test')\gexec

GRANT ALL PRIVILEGES ON DATABASE tac_test TO tac;
