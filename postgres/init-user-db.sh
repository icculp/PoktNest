#!/bin/bash
set -e

# Use environment variables
USER_NAME=${POSTGRES_USER:-default_user}
DB_NAME=${POSTGRES_DB:-default_db}
USER_PASSWORD=${POSTGRES_PASSWORD:-default_password}

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$USER_NAME') THEN
            CREATE USER $USER_NAME WITH PASSWORD '$USER_PASSWORD';
        END IF;
    END $$;
    DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = '$DB_NAME') THEN
            CREATE DATABASE $DB_NAME;
        END IF;
    END $$;
    GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $USER_NAME;
EOSQL
