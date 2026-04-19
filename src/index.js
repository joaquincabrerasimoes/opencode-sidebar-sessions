/**
 * @typedef {{
 *   id: string
 *   title: string
 *   updatedAt: number
 *   parentID?: string
 * }} SidebarSession
 */

/**
 * @typedef {{
 *   startedAt: number
 *   currentSessionID?: string
 *   openedSessions: SidebarSession[]
 *   currentSessionSubAgents: SidebarSession[]
 * }} SidebarState
 */

/**
 * @param {{ id: string, title?: string, parentID?: string, time?: { updated?: number } }} info
 * @returns {SidebarSession}
 */
function toSidebarSession(info) {
  return {
    id: info.id,
    title: info.title ?? info.id,
    updatedAt: info.time?.updated ?? Date.now(),
    parentID: info.parentID,
  }
}

/**
 * @param {unknown} result
 * @returns {any | undefined}
 */
function unwrap(result) {
  if (!result || typeof result !== "object") return undefined
  if ("error" in result && result.error) return undefined
  return "data" in result ? result.data : undefined
}

/**
 * Creates a sidebar state tracker for OpenCode sessions.
 *
 * @param {{
 *   client: {
 *     session: {
 *       get(params: { sessionID: string }): Promise<unknown>
 *       children(params: { sessionID: string }): Promise<unknown>
 *     }
 *     event: {
 *       subscribe(): Promise<{ stream: AsyncGenerator<any, any, any> }>
 *     }
 *   }
 * }} input
 */
export function createSidebarSessionsPlugin({ client }) {
  const startedAt = Date.now()
  /** @type {SidebarSession[]} */
  const openedSessions = []
  /** @type {SidebarSession[]} */
  let currentSessionSubAgents = []
  /** @type {string | undefined} */
  let currentSessionID
  /** @type {Set<(state: SidebarState) => void>} */
  const listeners = new Set()

  const notify = () => {
    const state = getState()
    for (const listener of listeners) listener(state)
  }

  const getState = () => ({
    startedAt,
    currentSessionID,
    openedSessions: [...openedSessions],
    currentSessionSubAgents: [...currentSessionSubAgents],
  })

  const refreshCurrentSubAgents = async () => {
    if (!currentSessionID) {
      currentSessionSubAgents = []
      return
    }
    const childrenResponse = await client.session.children({ sessionID: currentSessionID })
    const children = unwrap(childrenResponse)
    currentSessionSubAgents = Array.isArray(children) ? children.map(toSidebarSession) : []
  }

  /**
   * @param {string} sessionID
   */
  const selectSession = async (sessionID) => {
    currentSessionID = sessionID
    if (!openedSessions.some((session) => session.id === sessionID)) {
      const sessionResponse = await client.session.get({ sessionID })
      const session = unwrap(sessionResponse)
      openedSessions.push(session ? toSidebarSession(session) : toSidebarSession({ id: sessionID }))
    }
    await refreshCurrentSubAgents()
    notify()
  }

  /**
   * @param {any} event
   */
  const handleEvent = async (event) => {
    if (!event || typeof event !== "object") return

    if (event.type === "tui.session.select" && event.properties?.sessionID) {
      await selectSession(event.properties.sessionID)
      return
    }

    if (event.type === "session.updated" && event.properties?.info?.id) {
      const updated = toSidebarSession(event.properties.info)
      const index = openedSessions.findIndex((session) => session.id === updated.id)
      if (index >= 0) {
        openedSessions[index] = updated
        if (updated.id === currentSessionID) await refreshCurrentSubAgents()
        notify()
      }
      return
    }

    if (event.type === "session.created" && event.properties?.info?.parentID === currentSessionID) {
      await refreshCurrentSubAgents()
      notify()
      return
    }

    if (event.type === "session.deleted" && event.properties?.info?.id) {
      const deletedID = event.properties.info.id
      const index = openedSessions.findIndex((session) => session.id === deletedID)
      if (index >= 0) openedSessions.splice(index, 1)
      if (currentSessionID === deletedID) {
        currentSessionID = undefined
        currentSessionSubAgents = []
      } else if (event.properties.info.parentID === currentSessionID) {
        await refreshCurrentSubAgents()
      }
      notify()
    }
  }

  let abort = false
  let abortController
  const start = async () => {
    abort = false
    abortController = new AbortController()
    try {
      const streamResult = await client.event.subscribe({}, { signal: abortController.signal })
      for await (const chunk of streamResult.stream) {
        if (abort) break
        const payload = chunk?.data?.payload ?? chunk?.payload ?? chunk
        await handleEvent(payload)
      }
    } catch (error) {
      if (!abort) {
        throw new Error("Failed to subscribe to OpenCode events", { cause: error })
      }
    } finally {
      abortController = undefined
    }
  }

  return {
    start,
    stop() {
      abort = true
      abortController?.abort()
    },
    handleEvent,
    selectSession,
    getState,
    subscribe(listener) {
      listeners.add(listener)
      listener(getState())
      return () => listeners.delete(listener)
    },
  }
}
