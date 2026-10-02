export type Repo = {
  id: number
  name: string
  description: string | null
  language: string | null
  topics: string[]
  stargazersCount: number
  forksCount: number
  fork: boolean
  archived: boolean
  homepage: string | null
  htmlUrl: string
  pushedAt: string | null
}

export type Catalog = {
  syncedAt: string
  owner: string
  source: string
  complete: boolean
  count: number
  expectedCount: number
  fetchedCount: number
  publicRepos: number
  excludedCount: number
  pagesFetched: number
  repos: Repo[]
}

export type ForkFilter = 'all' | 'only' | 'hide'
export type ArchivedFilter = 'all' | 'only' | 'hide'

export type FilterState = {
  query: string
  languages: Set<string>
  forks: ForkFilter
  archived: ArchivedFilter
}

export type Vec3 = {
  x: number
  y: number
  z: number
}

export type StarLayout = {
  id: number
  name: string
  language: string
  fork: boolean
  archived: boolean
  position: Vec3
}
