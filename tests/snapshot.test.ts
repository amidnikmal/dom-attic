import { afterEach, describe, expect, it } from 'vitest'

import { createSnapshot, isSnapshot } from '../src/core/index'
import { cleanup, createCell } from './helpers'

afterEach(cleanup)

describe('createSnapshot', () => {
  it('copies markup and marks the clone', () => {
    const { live } = createCell()
    const clone = createSnapshot(live)!

    expect(clone.innerHTML).toBe(live.innerHTML)
    expect(isSnapshot(clone)).toBe(true)
    expect(isSnapshot(live)).toBe(false)
  })

  it('carries over value and checked, which attributes do not hold', () => {
    const live = document.createElement('div')
    const text = document.createElement('input')
    const box = document.createElement('input')
    box.type = 'checkbox'
    live.append(text, box)
    document.body.append(live)

    text.value = 'typed in'
    box.checked = true

    const clone = createSnapshot(live)!

    expect(clone.querySelectorAll('input')[0]!.value).toBe('typed in')
    expect(clone.querySelectorAll('input')[1]!.checked).toBe(true)
  })

  it('the clone is inert: listeners do not carry over', () => {
    const { live, clicks } = createCell()
    const clone = createSnapshot(live)!

    clone.querySelector('button')!.click()

    expect(clicks()).toBe(0)
  })
})

describe('snapshot size cap', () => {
  it('refuses to copy a cell that is too large to be worth it', () => {
    const live = document.createElement('div')
    for (let i = 0; i < 50; i++) live.append(document.createElement('span'))
    document.body.append(live)

    expect(createSnapshot(live, 500)).not.toBeNull()
    expect(createSnapshot(live, 10)).toBeNull()
  })
})

describe('lightweight copies', () => {
  it('keeps what is on screen and skips what is not', () => {
    const live = document.createElement('div')
    const visible = document.createElement('b')
    visible.textContent = 'on screen'
    const hidden = document.createElement('i')
    hidden.style.display = 'none'
    for (let i = 0; i < 200; i++) hidden.append(document.createElement('span'))

    live.append(visible, hidden)
    document.body.append(live)

    // The hidden branch is where the weight is, and none of it is copied.
    const copy = createSnapshot(live, 10)!

    expect(copy).not.toBeNull()
    expect(copy.textContent).toBe('on screen')
    expect(copy.querySelector('i')).toBeNull()
  })

  it('keeps an invisible node that decides what the parent shows', () => {
    const live = document.createElement('select')
    for (let i = 0; i < 500; i++) {
      const option = document.createElement('option')
      option.value = String(i)
      option.textContent = `entry ${i}`
      live.append(option)
    }
    live.value = '7'
    document.body.append(live)

    // A closed list draws none of its entries, but the chosen one is what the
    // control displays, so the copy keeps it — three nodes instead of 500.
    const copy = createSnapshot(live, 10)!

    expect(copy).not.toBeNull()
    expect(copy.querySelectorAll('option')).toHaveLength(1)
    expect(copy.textContent).toBe('entry 7')
  })
})
