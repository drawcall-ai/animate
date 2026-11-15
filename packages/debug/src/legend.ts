import { HUES } from './intent'

/** what the colours and marks of the view mean, as a small panel for the page to lay over the view */
export function legend() {
  const panel = document.createElement('div')
  panel.className = 'intent-legend'
  Object.assign(panel.style, {
    position: 'fixed',
    bottom: '8px',
    right: '8px',
    padding: '6px 8px',
    font: '10px/1.3 ui-monospace, monospace',
    color: '#eee',
    background: 'rgba(0,0,0,0.6)',
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '5',
  })
  const parts = Object.entries(HUES).map(
    ([name, hue]) => `<span style="color:#${hue.toString(16).padStart(6, '0')}">■</span> ${name}`,
  )
  const marks = [
    '◆ to be there in N s · line: the way there',
    '○ footfall foreseen · □ put by a story',
    'green→red: plan vs body (cm)',
    'arrows: faces · to face · led',
  ]
  panel.innerHTML = [parts.slice(0, 3).join(' '), parts.slice(3).join(' '), ...marks].join('<br>')
  return panel
}
