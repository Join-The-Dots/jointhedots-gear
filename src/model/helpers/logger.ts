
export interface Message {
   id: string
   pluginName: string
   text: string
   location: Location | null
   notes: Note[]

   /**
    * Optional user-specified data that is passed through unmodified. You can
    * use this to stash the original error, for example.
    */
   detail: any
}

export interface Note {
   text: string
   location: Location | null
}

export interface Location {
   file: string
   namespace: string
   /** 1-based */
   line: number
   /** 0-based, in bytes */
   column: number
   /** in bytes */
   length: number
   lineText: string
   suggestion: string
}

export type Severity = "error" | "warn" | "info" | "trace"

export interface LogEntry {
   severity: Severity
   message: Message
   timestamp: number
}

export class Log {
   readonly id: string
   private entries: LogEntry[] = []

   constructor(id: string) {
      this.id = id
   }

   put(severity: Severity, message: string | Error | Message): void {
      const entry: LogEntry = {
         severity,
         message: this.normalizeMessage(message),
         timestamp: Date.now()
      }
      this.entries.push(entry)
      console.log(stringifyLogEntryPretty(this.id, entry))
   }

   error(message: string | Error | Message): void { this.put("error", message) }
   warn(message: string | Error | Message): void { this.put("warn", message) }
   info(message: string | Error | Message): void { this.put("info", message) }
   trace(message: string | Error | Message): void { this.put("trace", message) }

   private normalizeMessage(message: string | Error | Message): Message {
      if (typeof message === "string") {
         return { id: "", pluginName: "", text: message, location: null, notes: [], detail: null }
      }
      if (message instanceof Error) {
         return { id: "", pluginName: "", text: message.message, location: null, notes: [], detail: message }
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

   get(id: string): Log {
      let logger = this.loggers.get(id)
      if (!logger) {
         logger = new Log(id)
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

export function stringifyLogEntry(loggerId: string, entry: LogEntry): string {
   const lines: string[] = []
   const prefix = `[${entry.severity.toUpperCase()}] [${loggerId}]`
   const loc = entry.message.location
   const locStr = loc ? ` ${loc.file}:${loc.line}:${loc.column}` : ""
   lines.push(`${prefix}${locStr} ${entry.message.text}`)
   for (const note of entry.message.notes) {
      const noteLoc = note.location
      const noteLocStr = noteLoc ? ` ${noteLoc.file}:${noteLoc.line}:${noteLoc.column}` : ""
      lines.push(`  note:${noteLocStr} ${note.text}`)
   }
   return lines.join("\n")
}

export function stringifyLogEntryPretty(loggerId: string, entry: LogEntry): string {
   const lines: string[] = []
   const styles: Record<Severity, { icon: string; color: string }> = {
      error: { icon: "✖", color: "\x1b[31m" },  // red
      warn: { icon: "⚠", color: "\x1b[33m" },  // yellow
      info: { icon: "ℹ", color: "\x1b[36m" },  // cyan
      trace: { icon: "·", color: "\x1b[90m" }  // gray
   }
   const reset = "\x1b[0m"
   const dim = "\x1b[2m"
   const bold = "\x1b[1m"
   const { icon, color } = styles[entry.severity]
   const loc = entry.message.location
   lines.push(`${dim}[${loggerId}]${reset} ${color}${bold}${icon}${reset} ${color}${entry.message.text}${reset}`)
   if (loc) {
      lines.push(`  ${dim}↪ ${loc.file}:${loc.line}:${loc.column}${reset}`)
   }
   for (const note of entry.message.notes) {
      const noteLoc = note.location
      const noteLocStr = noteLoc ? `${dim}${noteLoc.file}:${noteLoc.line}:${noteLoc.column}${reset} ` : ""
      lines.push(`  ${dim}↳${reset} ${noteLocStr}${note.text}`)
   }
   return lines.join("\n")
}
