# opencode-sidebar-sessions

Sidebar data plugin built with `@opencode-ai/sdk` for OpenCode.

It tracks:

- sessions opened since the current TUI startup (`tui.session.select` events)
- sub-agents (child sessions) of the currently opened session

## Install

```bash
npm install
```

## Run tests

```bash
npm test
```

## Usage

```js
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { createSidebarSessionsPlugin } from "./src/index.js"

const client = createOpencodeClient()
const plugin = createSidebarSessionsPlugin({ client })

// wire this to your sidebar renderer
plugin.subscribe((state) => {
  console.log(state)
})

// starts listening to server events
await plugin.start()
```
