import { URI } from "vscode-uri"
import { acquireComponent } from "../components/manifold.ts"
import { Log } from "../logging/index.ts"

export type Serializable = string | number | boolean | null | Serializable[] | { [key: string]: Serializable }

export type Cmdlet<CmdPayload extends Serializable = Serializable, CmdResult extends Serializable = Serializable> = {
   payload: CmdPayload,
   result: CmdResult
}

export type CmdPayload<C extends Cmdlet> = C extends { payload: infer P } ? P : void

export type CmdResult<C extends Cmdlet> = C extends { result: infer P } ? P : void


export interface Command<C extends Cmdlet = Cmdlet> {

   // Command
   target: string // Command target
   payload?: CmdPayload<C> // Command arguments

   // User friendly options
   icon?: string // Object icon
   title?: string // Object name
   summary?: string // Object short description

   // Security options (TODO)
   identity?: string // Authorization Token
   signature?: string // Signed by emitter providing Authorization Token
}

export interface CommandsService {
   execute<C extends Cmdlet>(cmd: string, data: CmdPayload<C>): Promise<CmdResult<C>>
}

export async function executeCommand(cmd: Command) {
   console.log("executeCommand:", cmd.target)
   const uri = URI.parse(cmd.target)
   const comp = acquireComponent(uri.authority)
   if (uri.scheme === "command") {
      try {
         const svc = await comp.fetchResource<CommandsService>("commands")
         if (svc?.execute instanceof Function) {
            svc.execute(uri.path, cmd.payload)
         }
         else throw new Error(`Invalid commands service`)
      }
      catch (e) {
         Log.error(e)
      }
   }
}
