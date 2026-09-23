#!/usr/bin/env bash
set -e

export TAG=$(git rev-parse HEAD | cut -c1-4)
echo "Using image tag:$TAG"

exec docker compose up -d
