/**
 * Tarjan's algorithm for finding strongly connected components (SCCs)
 * and producing a topological ordering of the condensation graph.
 * 
 * @param nodes - Array of node identifiers
 * @param edges - Function that returns outgoing edges for a node
 * @returns Array of SCCs in reverse topological order (dependencies first)
 */
function tarjanSCC<T>(
   nodes: Iterable<T>,
   edges: (node: T) => Iterable<T>
): T[][] {
   const index = new Map<T, number>()
   const lowlink = new Map<T, number>()
   const onStack = new Set<T>()
   const stack: T[] = []
   const sccs: T[][] = []
   let idx = 0

   function strongconnect(v: T): void {
      index.set(v, idx)
      lowlink.set(v, idx)
      idx++
      stack.push(v)
      onStack.add(v)

      for (const w of edges(v)) {
         if (!index.has(w)) {
            strongconnect(w)
            lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!))
         } else if (onStack.has(w)) {
            lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!))
         }
      }

      if (lowlink.get(v) === index.get(v)) {
         const scc: T[] = []
         let w: T
         do {
            w = stack.pop()!
            onStack.delete(w)
            scc.push(w)
         } while (w !== v)
         sccs.push(scc)
      }
   }

   for (const v of nodes) {
      if (!index.has(v)) {
         strongconnect(v)
      }
   }

   return sccs
}

/**
 * Topological sort using Tarjan's algorithm.
 * Returns nodes in dependency order (dependencies come first).
 * Throws if a cycle is detected.
 * 
 * @param nodes - Array of node identifiers
 * @param edges - Function that returns outgoing edges (dependencies) for a node
 * @returns Nodes in topological order
 */
export function topologicalSort<T>(
   nodes: Iterable<T>,
   edges: (node: T) => Iterable<T>
): T[] {
   const sccs = tarjanSCC(nodes, edges)

   for (const scc of sccs) {
      if (scc.length > 1) {
         throw new Error(`Cycle detected: ${scc.join(' -> ')}`)
      }
   }

   return sccs.map(scc => scc[0])
}

/**
 * Get topological order with cycle detection that returns cycle info instead of throwing.
 * 
 * @param nodes - Array of node identifiers  
 * @param edges - Function that returns outgoing edges for a node
 * @returns Object with ordered nodes and any detected cycles
 */
export function getGraphOrder<T>(
   nodes: Iterable<T>,
   edges: (node: T) => Iterable<T>
): { order: T[]; cycles: T[][] } {
   const sccs = tarjanSCC(nodes, edges)
   const order: T[] = []
   const cycles: T[][] = []

   for (const scc of sccs) {
      if (scc.length > 1) {
         cycles.push(scc)
      }
      order.push(...scc)
   }

   return { order, cycles }
}
