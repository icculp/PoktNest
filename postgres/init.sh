#!/bin/bash

# Check if the data directory has the PG_VERSION file
if [ ! -f /data/PG_VERSION ]; then
  # If not, initialize the data directory
  initdb -D /data
  chown -R 999:999 /data
fi

