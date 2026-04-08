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
  const collectionViews = Object.entries(recordMap.collection_view ?? {})
  if (!collectionViews.length) return recordMap

  const sortedCollectionView = Object.fromEntries(
    collectionViews.map(([viewId, view]) => {
      const v = view as any
      const value = v?.value?.value ?? v?.value ?? v

      const pageSort = value?.page_sort
      const sortProperty = value?.query2?.sort?.[0]?.property
      const direction = value?.query2?.sort?.[0]?.direction ?? 'descending'

      if (!pageSort || !sortProperty) return [viewId, view]

      const getDate = (blockId: string): number => {
        const block = (recordMap.block[blockId] as any)?.value
        const prop = block?.properties?.[sortProperty]
        const date = prop?.[0]?.[1]?.[0]?.[1]?.start_date
        if (date) return new Date(date).getTime()
        return block?.created_time ?? 0
      }

      const sortedPageSort = [...pageSort].sort((a: string, b: string) => {
        return direction === 'descending'
          ? getDate(b) - getDate(a)
          : getDate(a) - getDate(b)
      })

      return [viewId, {
        ...v,
        value: {
          ...v.value,
          value: {
            ...(v.value?.value ?? v.value),
            page_sort: sortedPageSort
          }
        }
      }]
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
