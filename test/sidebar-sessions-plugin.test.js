import test from "node:test"
import assert from "node:assert/strict"
import { createSidebarSessionsPlugin } from "../src/index.js"

function createClientMock() {
  const sessions = {
    s1: { id: "s1", title: "Session 1", time: { updated: 100 } },
    s2: { id: "s2", title: "Session 2", time: { updated: 200 } },
  }
  const children = {
    s1: [{ id: "a1", title: "Sub-agent A1", parentID: "s1", time: { updated: 110 } }],
    s2: [{ id: "a2", title: "Sub-agent A2", parentID: "s2", time: { updated: 210 } }],
  }

  return {
    session: {
      async get({ sessionID }) {
        return { data: sessions[sessionID] }
      },
      async children({ sessionID }) {
        return { data: children[sessionID] ?? [] }
      },
    },
    event: {
      async subscribe() {
        async function* stream() {}
        return { stream: stream() }
      },
    },
  }
}

test("tracks opened sessions and sub-agents for currently selected session", async () => {
  const plugin = createSidebarSessionsPlugin({ client: createClientMock() })

  await plugin.handleEvent({ type: "tui.session.select", properties: { sessionID: "s1" } })
  await plugin.handleEvent({ type: "tui.session.select", properties: { sessionID: "s2" } })
  await plugin.handleEvent({ type: "tui.session.select", properties: { sessionID: "s2" } })

  const state = plugin.getState()
  assert.deepEqual(
    state.openedSessions.map((session) => session.id),
    ["s1", "s2"],
  )
  assert.equal(state.currentSessionID, "s2")
  assert.deepEqual(
    state.currentSessionSubAgents.map((session) => session.id),
    ["a2"],
  )
})

test("updates and removes tracked sessions from lifecycle events", async () => {
  const plugin = createSidebarSessionsPlugin({ client: createClientMock() })

  await plugin.handleEvent({ type: "tui.session.select", properties: { sessionID: "s1" } })
  await plugin.handleEvent({
    type: "session.updated",
    properties: { info: { id: "s1", title: "Renamed Session", time: { updated: 999 } } },
  })

  let state = plugin.getState()
  assert.equal(state.openedSessions[0].title, "Renamed Session")

  await plugin.handleEvent({
    type: "session.deleted",
    properties: { info: { id: "s1", parentID: undefined } },
  })
  state = plugin.getState()
  assert.deepEqual(state.openedSessions, [])
  assert.equal(state.currentSessionID, undefined)
  assert.deepEqual(state.currentSessionSubAgents, [])
})
