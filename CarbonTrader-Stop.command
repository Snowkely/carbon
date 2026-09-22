#!/bin/bash
cd "$(dirname "$0")" || exit 1
bash deploy/local-classroom/classroom.sh stop
read -r -p "Press Return to close..."
