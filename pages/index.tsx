import type { PageProps } from '@/lib/types'
import { NotionPage } from '@/components/NotionPage'
import { domain } from '@/lib/config'
import { resolveNotionPage } from '@/lib/resolve-notion-page'

export const getServerSideProps = async () => {
  try {
    const props = await resolveNotionPage(domain)

    return { props }
  } catch (err) {
    console.error('page error', domain, err)
    throw err
  }
}

export default function NotionDomainPage(props: PageProps) {
  return <NotionPage {...props} />
}
