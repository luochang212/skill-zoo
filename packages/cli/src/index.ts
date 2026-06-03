#!/usr/bin/env node
import { runCli } from "./cli.js";

await runCli(process.argv.slice(2));
