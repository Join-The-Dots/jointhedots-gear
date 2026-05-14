
import Process from "node:process"

export interface Message {
   id: string
   text: string
   location?: Location | string
   notes?: Note[]

   /**
    * Optional user-specified data that is passed through unmodified. You can
    * use this to stash the original error, for example.
    */
   detail?: any
}

export interface Note {
   title?: string
   text: string
   location?: Location | string
}

export interface Location {
   file: string
   namespace?: string
   /** 1-based */
   line?: number
   /** 0-based, in bytes */
   column?: number
   /** in bytes */
   length?: number
   lineText?: string
   suggestion?: string
}

export type LogKind = "error" | "warn" | "info" | "success" | "debug" | "trace"
export type LogMode = "normal" | "debug" | "verbose"

export interface LogEntry {
   kind: LogKind
   message: Message
   timestamp: number
}

export class Log {
   readonly id: string
   readonly logger: Logger
   private entries: LogEntry[] = []

   constructor(id: string, logger: Logger) {
      this.id = id
      this.logger = logger
   }

   put(kind: LogKind, message: string | Error | Message): void {
      const entry: LogEntry = {
         kind,
         message: this.normalizeMessage(message),
         timestamp: Date.now()
      }
      this.entries.push(entry)
      if (!this.logger.silentKinds.has(kind)) {
         console.log(stringifyLogEntryPretty(this.id, entry))
      }
   }

   error(message: string | Error | Message): void { this.put("error", message) }
   warn(message: string | Error | Message): void { this.put("warn", message) }
   info(message: string | Error | Message): void { this.put("info", message) }
   success(message: string | Error | Message): void { this.put("success", message) }
   debug(message: string | Error | Message): void { this.put("debug", message) }
   trace(message: string | Error | Message): void { this.put("trace", message) }

   private normalizeMessage(message: string | Error | Message): Message {
      if (typeof message === "string") {
         return { id: "", text: message }
      }
      if (message instanceof Error) {
         return { id: "", text: message.message, detail: message }
      }
      return message
   }

   getEntries(): readonly LogEntry[] {
      return this.entries
   }

   clear(): void {
      this.entries = []
   }
}

export class Logger {
   private loggers = new Map<string, Log>()
   readonly mode: LogMode
   readonly silentKinds: Set<LogKind>

   constructor(mode: LogMode = getLogModeFromEnv()) {
      this.mode = mode
      this.silentKinds = getSilentKinds(mode)
   }

   get(id: string): Log {
      let logger = this.loggers.get(id)
      if (!logger) {
         logger = new Log(id, this)
         this.loggers.set(id, logger)
      }
      return logger
   }

   has(id: string): boolean {
      return this.loggers.has(id)
   }

   remove(id: string): boolean {
      return this.loggers.delete(id)
   }

   all(): IterableIterator<Log> {
      return this.loggers.values()
   }

   clear(): void {
      this.loggers.clear()
   }
}

function getLogModeFromEnv(): LogMode {
   const value = Process.env.JTDGEAR_LOG_MODE?.trim().toLowerCase()
   if (value === "debug" || value === "verbose" || value === "normal") {
      return value
   }
   return "normal"
}

function getSilentKinds(mode: LogMode): Set<LogKind> {
   switch (mode) {
      case "verbose":
         return new Set<LogKind>()
      case "debug":
         return new Set<LogKind>(["trace"])
      case "normal":
      default:
         return new Set<LogKind>(["trace", "debug"])
   }
}

export function stringifyLocation(loc: Location | string | null | undefined): string {
   if (!loc) return ""
   if (typeof loc === "string") return loc
   let str = loc.file
   if (loc.line != null) {
      str += `:${loc.line}`
      if (loc.column != null) {
         str += `:${loc.column}`
      }
   }
   return str
}

export function stringifyLogEntry(loggerId: string, entry: LogEntry): string {
   const lines: string[] = []
   const prefix = `[${entry.kind.toUpperCase()}] [${loggerId}]`
   const locStr = stringifyLocation(entry.message.location)
   lines.push(`${prefix}${locStr ? ` ${locStr}` : ""} ${entry.message.text}`)
   for (const note of entry.message.notes ?? []) {
      const noteTitle = note.title || "note"
      const noteLocStr = stringifyLocation(note.location)
      lines.push(`  ${noteTitle}: ${note.text}`)
      if (noteLocStr) {
         lines.push(`    at ${noteLocStr}`)
      }
   }
   return lines.join("\n")
}

export function stringifyLogEntryPretty(loggerId: string, entry: LogEntry): string {
   const lines: string[] = []
   const styles: Record<LogKind, { icon: string; color: string }> = {
      error: { icon: "✖", color: "\x1b[31m" },  // red
      warn: { icon: "⚠", color: "\x1b[33m" },  // yellow
      info: { icon: "▹", color: "\x1b[36m" },  // cyan
      success: { icon: "✔", color: "\x1b[32m" },  // green
      debug: { icon: "🪲", color: "\x1b[34m" },  // blue
      trace: { icon: "👣", color: "\x1b[90m" }  // gray
   }
   const reset = "\x1b[0m"
   const dim = "\x1b[2m"
   const bold = "\x1b[1m"
   const { icon, color } = styles[entry.kind]
   const locStr = stringifyLocation(entry.message.location)
   lines.push(`${dim}[${loggerId}]${reset} ${color}${bold}${icon}${reset} ${color}${entry.message.text}${reset}`)
   if (locStr) {
      lines.push(`  ${dim}↪ ${locStr}${reset}`)
   }
   for (const note of entry.message.notes ?? []) {
      const noteTitle = note.title || "note"
      const noteLocStr = stringifyLocation(note.location)
      lines.push(`  ${dim}↳${reset} ${bold}${noteTitle}:${reset} ${note.text}`)
      if (noteLocStr) {
         lines.push(`    ${dim}at ${noteLocStr}${reset}`)
      }
   }
   return lines.join("\n")
}
