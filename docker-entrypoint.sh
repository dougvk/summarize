#!/bin/sh
set -e

# Load Twitter cookies from file if it exists
# Mount your cookies file to /app/twitter-cookies.env
if [ -f /app/twitter-cookies.env ]; then
  echo "Loading Twitter cookies from /app/twitter-cookies.env"
  export $(grep -v '^#' /app/twitter-cookies.env | xargs)
fi

# Execute the main command
exec "$@"
