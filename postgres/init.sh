#!/bin/bash

# Check if the data directory has the PG_VERSION file
chown -R 999:999 /data
if [ ! -f /data/PG_VERSION ]; then
  # If not, initialize the data directory
  initdb -D /data
fi

