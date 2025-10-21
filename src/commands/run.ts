import NodeWatch from "node-watch"
import Process from 'process'
import Path from 'path'
import ChildProcess from 'child_process'
import { createRequire } from "module"
import { CommandModule } from "yargs"

const restart_always_on_change = true

const require = createRequire(import.meta.url)

export function command_run(): CommandModule<any, {
   dir?: string
   entry?: string
   inspect?: number
   break?: boolean
   "--"?: string[]
}> {
   return {
      command: 'run',
      describe: 'Command to execute a program',
      builder: (yargs) => yargs
         .option('dir', {
            describe: 'Path of folder to watch for auto restart',
            type: 'string',
            require: true,
         })
         .option('entry', {
            describe: 'Path of program to execute',
            type: 'string',
            require: true,
         })
         .option('inspect', {
            describe: 'Port of debugger',
            type: 'number',
         })
         .option('break', {
            describe: 'Debugger with break at start',
            type: 'boolean',
         })
         .parserConfiguration({
            'populate--': true,
         }),
      handler: async (argv) => {
         let current: any = null
         let currentRestart_timer: any = undefined
         const entry_path = Path.resolve(argv.dir, argv.entry)
         const entry_args = argv["--"] || []
         console.log(`\x1b[32m[monitor] Watch '${argv.dir}' -> '${argv.entry}'\x1b[0m`)

         function start(withBreak = false) {

            let node_args: string[] = []
            if (argv.inspect) {
               if (withBreak || argv.break) withBreak = true
               node_args.push(`--inspect${withBreak ? "-brk" : ""}=${argv.inspect}`)
            }
            else withBreak = false

            console.log(`\x1b[32m[monitor] Start process${withBreak ? " (in break mode)" : ""}\x1b[0m`)
            current = ChildProcess.spawn(
               "node",
               [
                  "--require=" + require.resolve("source-map-support/register"),
                  "--require=" + require.resolve("tsconfig-paths/register"),
                  "--enable-source-maps",
                  ...node_args,
                  entry_path,
                  ...entry_args
               ],
               {
                  stdio: [Process.stdin, Process.stdout, Process.stderr],
               }
            )
            current.on("exit", (code) => {
               current = null
               if (currentRestart_timer !== undefined) {
                  console.log(`\x1b[32m[monitor] Restart after 'change'\x1b[0m`)
                  currentRestart_timer = undefined
                  start()
               }
               else {
                  console.log(`\x1b[${code < 0 ? "31m" : "33m"}[monitor] Process 'exit' (Press Enter or Backspace(breakmode) to restart)\x1b[0m`)
               }
            })
         }

         function restart() {
            const shall_respawn = current ? restart_always_on_change : true
            if (shall_respawn && currentRestart_timer === undefined) {
               const timer = setTimeout(() => {
                  if (currentRestart_timer === timer) {
                     console.log(`\x1b[32m[monitor] Kill process, after 'change'\x1b[0m`)
                     if (current) current.kill()
                     else start()
                  }
               }, 100)
               currentRestart_timer = timer
            }
         }

         function onKeyPress(key) {
            if (key == '\u000d') { // Enter
               if (!current) start(false)
            }
            else if (key == '\u0008') { // Backspace
               if (!current) start(true)
            }
            else if (key == '\u0003') { // ctrl-c
               Process.exit()
            }
         }

         Process.stdin.setRawMode(true)
         Process.stdin.resume()
         Process.stdin.on('data', onKeyPress)

         const watcher = NodeWatch(argv.dir, { recursive: true }) as any
         watcher.on('change', () => restart())
         start()
      }
   }
}
