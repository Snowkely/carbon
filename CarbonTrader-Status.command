#!/bin/bash
cd "$(dirname "$0")" || exit 1
bash deploy/local-classroom/classroom.sh status
read -r -p "Press Return to close..."
