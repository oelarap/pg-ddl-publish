#!/usr/bin/env node
import { runCli } from './cli-app.js';

runCli(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
