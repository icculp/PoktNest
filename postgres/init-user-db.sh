#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE USER cnt;
	CREATE DATABASE pokt;
	GRANT ALL PRIVILEGES ON DATABASE pokt TO cnt;
EOSQL
