#!/usr/bin/env node
import "source-map-support/register.js"
import Process from "node:process"
import Yargs from "yargs"
import { hideBin } from 'yargs/helpers'
import { command_run } from "./commands/run.js"
import { command_init } from "./commands/init.js"
import { command_make } from "./commands/make.js"
import { command_serve } from "./commands/serve.js"
import { command_publish } from "./commands/publish.js"

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
