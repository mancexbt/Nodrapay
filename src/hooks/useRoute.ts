import { useSyncExternalStore } from 'react'
import { PLAN_BY_ID, type PageId } from '@/lib/plans'

/** Three pages: the front page (#/), About (#/about) and the app (#/app/<section>). Hash routing works on any static host. */
export type Route = { name: 'home' } | { name: 'about' } | { name: 'app'; page: Exclude<PageId, 'overview'> }

function parse(hash: string): Route {
  const [, root, section] = hash.replace(/^#/, '').split('/')
  if (root === 'about') return { name: 'about' }
  if (root !== 'app') return { name: 'home' }
  const page = section === 'escrow' || (section && section in PLAN_BY_ID) ? (section as Exclude<PageId, 'overview'>) : 'escrow'
  return { name: 'app', page }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const snapshot = () => window.location.hash

export function useRoute(): Route {
  return parse(useSyncExternalStore(subscribe, snapshot, () => ''))
}

/** Go to the front page ('overview') or a section of the app. */
export function navigate(to: PageId | 'about') {
  window.location.hash = to === 'overview' ? '#/' : to === 'about' ? '#/about' : `#/app/${to}`
}
