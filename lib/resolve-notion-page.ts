import { type ExtendedRecordMap } from 'notion-types'
import { parsePageId } from 'notion-utils'

import type { PageProps } from './types'
import * as acl from './acl'
import { environment, pageUrlAdditions, pageUrlOverrides, site } from './config'
import { db } from './db'
import { getSiteMap } from './get-site-map'
import { getPage } from './notion'

// Sort collection pages by Published date descending
function sortRecordMapByPublishedDate(recordMap: ExtendedRecordMap): ExtendedRecordMap {
  const collections = Object.values(recordMap.collection ?? {})
  if (!collections.length) return recordMap

  const collectionEntry = collections[0]
  if (!collectionEntry) return recordMap

  const collection = ('value' in collectionEntry ? collectionEntry.value : collectionEntry) as any
  const schema = collection.schema
  if (!schema) return recordMap

  const publishedKey = Object.keys(schema).find(
    (k) => schema[k]?.name?.toLowerCase() === 'published'
  )
  if (!publishedKey) return recordMap

  const getDate = (blockId: string): number => {
    const block = (recordMap.block[blockId] as any)?.value
    const prop = block?.properties?.[publishedKey]
    const date = prop?.[0]?.[1]?.[0]?.[1]?.start_date
    return date ? new Date(date).getTime() : 0
  }

  // Sort the collection_view page_sort arrays
  const sortedCollectionView = Object.fromEntries(
    Object.entries(recordMap.collection_view ?? {}).map(([viewId, view]) => {
      const v = view as any
      const pageSort = v?.value?.page_sort ?? v?.page_sort
      if (!pageSort) return [viewId, view]

      const sortedPageSort = [...pageSort].sort((a, b) => getDate(b) - getDate(a))

      const updatedView = {
        ...v,
        value: {
          ...(v.value ?? v),
          page_sort: sortedPageSort
        }
      }
      return [viewId, updatedView]
    })
  )

  return {
    ...recordMap,
    collection_view: sortedCollectionView
  }
}

export async function resolveNotionPage(
  domain: string,
  rawPageId?: string
): Promise<PageProps> {
  let pageId: string | undefined
  let recordMap: ExtendedRecordMap

  if (rawPageId && rawPageId !== 'index') {
    pageId = parsePageId(rawPageId)!

    if (!pageId) {
      const override =
        pageUrlOverrides[rawPageId] || pageUrlAdditions[rawPageId]

      if (override) {
        pageId = parsePageId(override)!
      }
    }

    const useUriToPageIdCache = true
    const cacheKey = `uri-to-page-id:${domain}:${environment}:${rawPageId}`
    const cacheTTL = undefined

    if (!pageId && useUriToPageIdCache) {
      try {
        pageId = await db.get(cacheKey)
      } catch (err: any) {
        console.warn(`redis error get "${cacheKey}"`, err.message)
      }
    }

    if (pageId) {
      recordMap = await getPage(pageId)
    } else {
      const siteMap = await getSiteMap()
      pageId = siteMap?.canonicalPageMap[rawPageId]

      if (pageId) {
        recordMap = await getPage(pageId)

        if (useUriToPageIdCache) {
          try {
            await db.set(cacheKey, pageId, cacheTTL)
          } catch (err: any) {
            console.warn(`redis error set "${cacheKey}"`, err.message)
          }
        }
      } else {
        return {
          error: {
            message: `Not found "${rawPageId}"`,
            statusCode: 404
          }
        }
      }
    }
  } else {
    pageId = site.rootNotionPageId
    console.log(site)
    recordMap = await getPage(pageId)
  }

  const props: PageProps = { site, recordMap, pageId }
  const aclProps = await acl.pageAcl(props)
  const sortedRecordMap = sortRecordMapByPublishedDate(props.recordMap!)
  return { ...props, ...aclProps, recordMap: sortedRecordMap }
}
