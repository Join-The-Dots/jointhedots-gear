
export function toNumberedLine(text: string): string {
   const lines = text.split("\n")
   return lines.map((l, i) => `${(i + 1).toString().padStart(3, "0")}: ${l}`).join("\n")
}
