import { getComponentFromData } from "../components/manifold.ts"
import type { Command } from "../interfaces/commands/interface.ts"
export { print } from "./trace.ts"

export type LogObjectID = string

export type LogStatus =
   "error" |
   "warn" |
   "notify" |
   "info"

export type LogKind =
   "event" |
   "ticket"

export interface ILogDispatcher {
   notifyError(error: Error, subject?: any)
   notifyObject(object: LogObject)
}

export interface ILogSubject {
   getSubject(): string
}

export interface LogAction extends Command {
   optional?: boolean
   doc_uri?: string
   callback?: Command
}

export interface LogObject {
   id: LogObjectID
   kind: LogKind
   status: LogStatus
   message: string // Object short description
   component_id: string // Object resource or component id
   doc_uri?: string

   icon?: string // Object icon
   title?: string // Object name
   attributes?: Record<string, string | number>
   actions?: LogAction[] // Object tooling list
}

class ConsoleLog implements ILogDispatcher {
   notifyError(error: Error, target?: any) {
      console.error(error)
      this.notifyObject(createLogFromError(error, target))
   }
   notifyObject(object: LogObject) {
      log_objects.push(object)
      console.log(object)
   }
}

const log_dispatchers = new Set<ILogDispatcher>()
const log_objects: LogObject[] = []
let log_object_ids = 0

const default_log = new ConsoleLog()
registerLogCollector(default_log)

function generateLogId() {
   log_object_ids++
   return 'id-' + Date.now().toString(36) + '-' + log_object_ids.toString(2)
}

export function registerLogCollector(collector: ILogDispatcher) {
   log_dispatchers.add(collector)
}

export function unregisterLogCollector(collector: ILogDispatcher) {
   log_dispatchers.delete(collector)
}

export function queryLogCount(): number {
   return log_objects.length
}

export type QueryLogResult = {
   objects: LogObject[]
   hasMore: boolean
}

export function queryLogObjects(count: number, component_id?: string): QueryLogResult {
   const objects = []
   for (const obj of log_objects) {
      if (component_id === undefined || component_id === obj.component_id) {
         if (objects.length >= count) {
            return { objects, hasMore: true }
         }
         objects.push(obj)
      }
   }
   return { objects, hasMore: false }
}

export type LogInfos = {
   action_expected_count: number
   error_count: number
   warn_count: number
   notify_count: number
   info_count: number
}

export function queryLogInfos(component_id?: string): LogInfos {
   return log_objects.reduce((info, obj) => {
      if (component_id === undefined || component_id === obj.component_id) {
         switch (obj.status) {
            case "error":
               info.error_count++
               info.warn_count++
               info.notify_count++
               info.info_count++
               break
            case "warn":
               info.warn_count++
               info.notify_count++
               info.info_count++
               break
            case "notify":
               info.notify_count++
               info.info_count++
               break
            case "info":
               info.info_count++
               break
         }
      }
      return info
   }, {
      action_expected_count: 0,
      error_count: 0,
      warn_count: 0,
      notify_count: 0,
      info_count: 0,
   })
}

export const Log = {
   send(object: LogObject) {
      setTimeout(() => {
         for (const collector of log_dispatchers) {
            collector.notifyObject(object)
         }
      }, 0)
   },
   error(error: Error, target?: any) {
      setTimeout(() => {
         for (const collector of log_dispatchers) {
            collector.notifyError(error, target)
         }
      }, 0)
   },
   event(target: any, options?: Partial<LogObject>) {
      const entry = getComponentFromData(target)
      const id = generateLogId()
      Log.send({
         ...options,
         kind: "event",
         status: options.status || "error",
         message: options.message || `Issue with component: ${id}`,
         component_id: entry.id,
         id,
      })
   },
   openTicket(target: any, name: string, options?: Partial<LogObject>) {
      const entry = getComponentFromData(target)
      const id = `${entry.id}/${name}`
      Log.send({
         ...options,
         kind: "ticket",
         status: options.status || "error",
         message: options.message || `Issue with component: ${id}`,
         component_id: entry.id,
         id,
      })
   },
   closeTicket(target: any, name: string) {
      const entry = getComponentFromData(target)
      const id = `${entry.id}/${name}`
      const index = log_objects.findIndex(x => x.id === id)
      if (index >= 0) {
         const ticket = log_objects[index]
         log_objects.splice(index, 1)
         Log.event(target, {
            ...ticket,
            kind: "event",
            status: "info",
            icon: "[success]bi:check-circle",
            message: `[closed] ${ticket.message}`,
            actions: undefined,
            doc_uri: undefined,
         })
      }
   },
}

export function createLogFromError(error: Error, target?: any): LogObject {
   return {
      id: generateLogId(),
      kind: "event",
      status: "error",
      component_id: getComponentFromData(target).id,
      message: error.message,
   }
}
