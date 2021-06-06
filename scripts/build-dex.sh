#!/usr/bin/env sh
# uses Pokemon-Showdown's dex data to build our own dex file

cd $(dirname $0)

dex_file=../src/psbot/handlers/battle/formats/gen4/dex/dex.ts
npx ts-node build-dex.ts > $dex_file

# try to fix any style errors, ignoring unfixable ones
npx tslint --fix $dex_file > /dev/null

# tslint will make this script return an error code so override that
exit 0
