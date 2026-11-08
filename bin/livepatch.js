#!/usr/bin/env node
'use strict';

const { main, CliError } = require('../cli');

main(process.argv.slice(2)).catch((err) => {
  console.error(`\n  \x1b[31m✖\x1b[0m ${err instanceof CliError ? err.message : err.stack || err}\n`);
  process.exit(1);
});
