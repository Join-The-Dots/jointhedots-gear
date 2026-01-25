
export type PathNode<State> = Map<string, PathNode<State> | State>

function isPathNode<State>(value: PathNode<State> | State) {
   return value instanceof Map
}

export class PathQualifier<State> {
   root: PathNode<State> = new Map();

   set(path: string, state: State): boolean {
      if (typeof path !== "string") return false
      let node = this.root
      const segments = path.split(/[/\\]/g).filter(Boolean)

      for (let i = 0; i < segments.length; i++) {
         const segment = segments[i]
         const current = node.get(segment)

         // If we hit a terminal node (true or false) before the end, we can't add deeper
         if (!isPathNode(current) && current !== undefined) {
            return false
         }

         // Last segment: assign the terminal_state (true or false)
         if (i === segments.length - 1) {
            // If there's already a terminal node here, don't override it
            if (!isPathNode(current) && current !== undefined) {
               return false
            }
            node.set(segment, state)
            return true
         }

         // Traverse or create intermediate node
         if (isPathNode(current)) {
            node = current
         } else {
            const newNode: PathNode<State> = new Map()
            node.set(segment, newNode)
            node = newNode
         }
      }

      return true
   }

   check(path: string): State | undefined {
      let node = this.root
      const segments = path.split(/[/\\]/g).filter(Boolean)
      for (let i = 0; i < segments.length; i++) {
         const segment = segments[i]
         const current = node.get(segment)
         if (current === undefined) {
            return undefined
         }
         if (!isPathNode(current)) {
            return current
         }
         node = current
      }
   }

   match(path: string, update: (state: State, segments: string[], index: number) => State): State {
      let node = this.root
      const segments = path.split(/[/\\]/g).filter(Boolean)
      for (let i = 0; i < segments.length; i++) {
         const segment = segments[i]
         const state = node.get(segment)
         if (state === undefined) {
            return undefined
         }
         if (!isPathNode(state)) {
            const new_state = update(state, segments, i)
            node.set(segment, new_state)
            return new_state
         }
         node = state
      }
   }

   traverse(callback: (segments: string[], state: State) => void, _node = this.root, _segments = []) {
      for (const key in _node) {
         const value = _node.get(key)
         _segments.push(key)
         if (isPathNode(value)) {
            this.traverse(callback, value, _segments)
         } else {
            callback(_segments, value)
         }
         _segments.pop()
      }
   }
}

export function createPathPrefixMatcher(prefixes: string[]) {
   // Remove leading/trailing slashes and escape regex special characters
   const sanitized = prefixes.map(prefix => {
      const trimmed = prefix.replace(/^\/+|\/+$/g, '')
      return trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
   })

   // Join into group and allow suffix to be either `/` or end-of-line
   const pattern = '^/(' + sanitized.join('|') + ')(/|$)'
   return new RegExp(pattern)
}
