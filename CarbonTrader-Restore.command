#!/bin/bash
cd "$(dirname "$0")" || exit 1
bash deploy/local-classroom/classroom-data.sh restore
read -r -p "Press Return to close..."
