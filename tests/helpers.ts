/** Ячейка со счётчиком: клик по кнопке инкрементит состояние живого узла. */
export function createCell(): { host: HTMLElement, live: HTMLElement, clicks: () => number } {
  const host = document.createElement('div')
  const live = document.createElement('div')
  const button = document.createElement('button')
  const label = document.createElement('span')

  let clicks = 0
  label.textContent = '0'
  button.textContent = '+'
  button.addEventListener('click', () => {
    clicks++
    label.textContent = String(clicks)
  })

  live.append(button, label)
  host.append(live)
  document.body.append(host)

  return { host, live, clicks: () => clicks }
}

export function cleanup(): void {
  document.body.replaceChildren()
}
