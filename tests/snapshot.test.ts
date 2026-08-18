import { afterEach, describe, expect, it } from 'vitest'

import { createSnapshot, isSnapshot } from '../src/core/index'
import { cleanup, createCell } from './helpers'

afterEach(cleanup)

describe('createSnapshot', () => {
  it('копирует разметку и помечает копию', () => {
    const { live } = createCell()
    const clone = createSnapshot(live)

    expect(clone.innerHTML).toBe(live.innerHTML)
    expect(isSnapshot(clone)).toBe(true)
    expect(isSnapshot(live)).toBe(false)
  })

  it('переносит value и checked, которых нет в атрибутах', () => {
    const live = document.createElement('div')
    const text = document.createElement('input')
    const box = document.createElement('input')
    box.type = 'checkbox'
    live.append(text, box)
    document.body.append(live)

    text.value = 'напечатано'
    box.checked = true

    const clone = createSnapshot(live)

    expect(clone.querySelectorAll('input')[0]!.value).toBe('напечатано')
    expect(clone.querySelectorAll('input')[1]!.checked).toBe(true)
  })

  it('копия инертна: слушатели не переносятся', () => {
    const { live, clicks } = createCell()
    const clone = createSnapshot(live)

    clone.querySelector('button')!.click()

    expect(clicks()).toBe(0)
  })
})
