# dom-attic

Mount heavy components once, show cheap snapshots, revive them on interaction.

## Why

List virtualization saves DOM at the cost of remounting: a row scrolls out of view and its
components are destroyed, it scrolls back and they are built from scratch. When a cell is
expensive (a select with 10,000 options, an editor, a chart), scrolling turns into endless
rebuilding, and every cell loses its internal state along the way.

`dom-attic` inverts that. A component is mounted **once for the lifetime of the page** and is
never recreated. When it is not needed, its DOM node moves into a detached container, where
there is no layout and no paint, yet the component stays alive and keeps receiving updates.
In its place the host keeps an inert snapshot, a `cloneNode` of the live node.

As soon as the user touches the snapshot, it steps aside and the real component takes over
with all of its state intact.

## Install

```sh
npm i dom-attic
```

## Core (no framework)

The core is plain DOM. It does not import Vue, React or anything else.

```ts
import { Attic, attachInteraction } from 'dom-attic'

const attic = new Attic({ liveLimit: 20 })

attic.register('row-1:status', hostElement) // host already holds the mounted node
attic.park('row-1:status')                  // node goes to storage, a snapshot stays behind

const detach = attachInteraction(attic, tableRoot) // one listener for the whole list
```

| Method | What it does |
|---|---|
| `register(key, host)` | put a cell under management |
| `park(key)` | move the live node away, leaving a fresh snapshot |
| `revive(key)` | bring the live node back, evicting the oldest beyond `liveLimit` |
| `markDirty(key)` / `refresh(key)` | data changed, so retake the snapshot |
| `stats` | how many cells are registered, live and parked |
| `dispose()` | return every node to the document for the framework to unmount |

### Options

```ts
new Attic({
  liveLimit: 20,      // how many live nodes may sit in the document at once
  replayEvents: true, // repeat the original event on the revived node
  onEvict: (key) => {},
})
```

## Vue

```vue
<script setup>
import { AtticCell, useAtticRoot } from 'dom-attic/vue'

const { rootRef, stats } = useAtticRoot({ liveLimit: 20 })
</script>

<template>
  <div ref="rootRef">
    <AtticCell
      v-for="row in rows"
      :key="row.id"
      :cell-key="row.id"
      :revision="row.updatedAt"
    >
      <HeavySelect v-model="row.status" :options="tenThousand" />
    </AtticCell>
  </div>
</template>
```

`useAtticRoot` creates the storage and wires interaction to `rootRef`. `AtticCell` registers
its own root element, parks it right after mount, and retakes the snapshot whenever
`revision` changes. Pass `:park-on-mount="false"` for cells that must stay live.

A React adapter is planned along the same lines: the core knows nothing about frameworks.

## How the first click survives

A snapshot is inert, so the click has to reach the real component. On `pointerdown` the
library records the path to the pressed element, swaps the snapshot for the live node, finds
the twin element by that same path and replays the event on it. Without this the first click
would be swallowed: the browser never delivers `click` to an element that left the document.

## Surviving virtualization

A virtualized list removes rows from the DOM, and a framework destroys whatever it mounted
inside them, snapshots included. The farm keeps that content mounted out of sight and lends
a node to whichever placeholder shows it right now:

```vue
<script setup>
import { AtticFarm, AtticSlot, useFarm } from 'dom-attic/vue'

useFarm()
</script>

<template>
  <!-- Rendered once per key, wherever the rows are or are not -->
  <AtticFarm :keys="warmKeys" v-slot="{ cellKey }">
    <HeavySelect :model-value="valueOf(cellKey)" :options="tenThousand" />
  </AtticFarm>

  <!-- Inside the virtualized row: shows the node, mounts nothing -->
  <AtticSlot :cell-key="`${row.id}:status`" />
</template>
```

Scrolling a row away releases the node back to the farm; scrolling it back adopts the very
same node, with its state intact. Give `AtticSlot` a `fallback` slot to show something cheap
while heavy content is still mounting:

```vue
<AtticSlot :cell-key="key">
  <template #fallback>{{ row.status }}</template>
</AtticSlot>
```

The fallback stays in the host next to the real content, so hide it with CSS once it is no
longer the only child: `.attic-slot > .fallback:not(:only-child) { display: none }`.

`keys` may arrive in any order: the farm renders them sorted, so reordering the data (a sort,
a drag) never moves a node a placeholder is currently showing. Keep the set bounded, though:
it is exactly the set of cells you are willing to keep alive at once.

Only a real change of `keys` counts as the window moving: a parent that re-renders often —
an inline function in a prop is enough — hands over a fresh array with the same contents, and
treating that as movement would postpone mounting indefinitely.

Growth is paced rather than immediate. Nothing is mounted while the window is still moving —
heavy content costs more than a frame, so building it mid-scroll stutters, and the `fallback`
slot covers the wait. Once scrolling settles, cells on screen are filled first, several per
slice (`visibleSlice`), and the surroundings follow one slice at a time. Slice size adapts to
how long the previous one took, and content leaving the window is released the same way.

| Prop | |
|---|---|
| `chunk` | upper bound for entries added per slice (20) |
| `visibleSlice` | minimum slice for cells on screen (6) |
| `settleDelay` | quiet time before growth resumes, ms (150) |

## Limitations

- cell content must be a **single root element**, only the first node is snapshotted;
- `canvas` and `video` are not carried over into a snapshot, mount such cells with
  `parkOnMount: false`;
- tooltips and popovers that live outside the cell do not work on a snapshot until it revives;
- a cell holding focus should not be evicted, so keep `liveLimit` comfortable.

## Development

```sh
npm run dev        # playground
npm test           # unit tests, run in a real browser
npm run test:e2e   # interaction scenarios
npm run build
```

Tests run in Chromium rather than a DOM emulator: the library works with detached nodes,
focus and synthetic clicks, and emulation is not faithful enough there.

## License

MIT
