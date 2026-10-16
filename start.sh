#!/bin/bash
# Launch Client Clock (quit it from the menu-bar clock icon → Quit).
cd "$(dirname "$0")" && ./node_modules/.bin/electron . >/tmp/client-clock.log 2>&1 &
