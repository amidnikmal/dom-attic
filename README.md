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

Pass `revision` to `AtticSlot` — any value that changes with the cell's data — so a copy
taken before a change is dropped and replaced. Without it a cell that was edited and then
scrolled away would come back showing what it used to be.

A press on a cell that is still showing a copy or a placeholder is not lost: the cell jumps
the queue, and the press is repeated on the matching element of the real content once it
arrives.

Scrolling a row away releases the node back to the farm; scrolling it back adopts the very
same node, with its state intact. Give `AtticSlot` a `fallback` slot to show something cheap
while heavy content is still mounting:

```vue
<AtticSlot :cell-key="key">
  <template #fallback>{{ row.status }}</template>
</AtticSlot>
```

A cell that has been shown at least once is photographed in idle time, one cell per slice, and its frozen copy
stands in for it the moment it comes back into view — cloning a mounted node is an order of
magnitude cheaper than building it, so the cell is never blank on return. The copy carries
`data-attic-snapshot`; for a cell shown for the first time there is nothing to copy yet, and
the `fallback` slot covers that case.

A copy is taken as soon as a cell settles, not once everything else is done: copies matter
most while there is still something left to mount.

A copy keeps what is on screen and walks past what is not, which is where the weight of a
heavy component usually sits: a list of thousands of entries showing one of them, a
virtualized panel holding a window of rows. Nodes that draw nothing yet decide what their
parent shows — a chosen entry, a ticked box, an opened section — are kept regardless. A
closed list of 2000 entries therefore copies as three nodes, pixel for pixel.

A parent with a crowd of children is judged by the cheap signs alone — asking ten thousand
entries for their geometry costs more than the copy saves.

`maxSnapshotNodes` (400 by default) caps the copy itself, not the original. Hitting the cap
means the copy would be a torn version of the cell, so none is made and `fallback` covers it.

The fallback is wrapped in `.attic-fallback` and stays in the host next to the real content.
A host that is still waiting for its content carries `data-attic-pending` — the mark is
derived from the farm's own state, so it can never be left behind, so two rules cover
the whole handover:

```css
/* waiting: show the frozen copy, or the fallback when there is none yet */
.attic-slot[data-attic-pending] > :not(.attic-fallback):not([data-attic-snapshot]) { display: none }
.attic-slot[data-attic-pending]:has([data-attic-snapshot]) > .attic-fallback { display: none }

/* settled: the live content is here, everything else steps aside */
.attic-slot:not([data-attic-pending]) > .attic-fallback:not(:only-child) { display: none }
```

`keys` are served in the order they are given, so listing them the way rows are laid out
makes content appear top to bottom rather than scattered around. Order does not affect
correctness: every entry is teleported to its own host, so reordering the data (a sort, a
drag) never moves a node a placeholder is currently showing. Keep the set bounded, though:
it is exactly the set of cells you are willing to keep alive at once.

Only a real change of `keys` counts as the window moving: a parent that re-renders often —
an inline function in a prop is enough — hands over a fresh array with the same contents, and
treating that as movement would postpone mounting indefinitely.

Growth is paced rather than immediate. Nothing is mounted while the window is still moving —
heavy content costs more than a frame, so building it mid-scroll stutters, and the `fallback`
slot covers the wait. Once scrolling settles, cells on screen are filled first, several per slice
(`visibleSlice`) — but only while a cell is cheap enough to afford it: a handful of expensive
ones in a single patch is the very freeze this pacing exists to avoid. The surroundings
follow one slice at a time. Slice size adapts to
how long the previous one took, and content leaving the window is released the same way.

| Prop | |
|---|---|
| `chunk` | upper bound for entries added per slice (20) |
| `visibleSlice` | minimum slice for cells on screen (6) |
| `settleDelay` | quiet time before growth resumes, ms (150) |

## Looking inside

The farm answers two questions without any guesswork on the caller's side:

```ts
farm.inspect(key)
// { claimed, grown, settled, hasSnapshot, uncopyable }

farm.stats
// counters since start: grown, adopted, released, captured, tooLarge
// sizes right now:      content, claimed, snapshots
```

`farm.capture(key, maxNodes?)` takes a copy of a cell on demand — the farm finds the content
itself and tells the placeholder and any existing copy apart from it. It returns false when
there is nothing to copy yet, and remembers a cell that turned out too large so it is not
tried again.

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
