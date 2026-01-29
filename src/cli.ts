#!/usr/bin/env node
import Process from "node:process"
import Yargs from "yargs"
import { hideBin } from 'yargs/helpers'
import { command_run } from "./commands/run.ts"
import { command_init } from "./commands/init.ts"
import { command_make } from "./commands/make.ts"
import { command_serve } from "./commands/serve.ts"
import { command_publish } from "./commands/publish.ts"

function command_fail() {
   return {
      command: '*',
      handler: async (argv) => {
         throw "Error: Invalid command"
      }
   }
}

Yargs(hideBin(Process.argv)).scriptName("jointhedots-gear")
   .command(command_init())
   .command(command_make())
   .command(command_serve())
   .command(command_publish())
   .command(command_run())
   .command(command_fail())
   .showHelpOnFail(true)
   .help()
   .parse()
