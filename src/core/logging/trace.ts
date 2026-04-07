
export const originalConsole = { ...console }

export const logError = console.error = (...args: any[]): void => {
   originalConsole.error(
      ...args.map(arg =>
         typeof arg === "string" ? `\x1b[31m${arg}\x1b[0m` : arg
      )
   )
}

export const logWarning = console.warn = (...args: any[]): void => {
   originalConsole.warn(
      ...args.map(arg =>
         typeof arg === "string" ? `\x1b[35m${arg}\x1b[0m` : arg
      )
   )
}

export const logInfo = console.info = (...args: any[]): void => {
   originalConsole.info(
      ...args.map(arg =>
         typeof arg === "string" ? `\x1b[36m${arg}\x1b[0m` : arg
      )
   )
}

export const logTrace = console.trace = (...args: any[]): void => {
   originalConsole.trace(
      ...args.map(arg =>
         typeof arg === "string" ? `\x1b[34m${arg}\x1b[0m` : arg
      )
   )
}

export const logDebug = console.debug = (...args: any[]): void => {
   originalConsole.debug(
      ...args.map(arg =>
         typeof arg === "string" ? `\x1b[32m${arg}\x1b[0m` : arg
      )
   )
}

export const print = console
