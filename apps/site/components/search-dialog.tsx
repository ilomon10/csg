'use client';
import {useDocsSearch} from 'fumadocs-core/search/client';
import {staticClient} from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import {siteConfig} from '@/lib/site-config';

const client = staticClient({from: `${siteConfig.basePath}/api/search`});

/** Static Orama search: the index is a file in the export (REQ-WEB-012). */
export function StaticSearchDialog(props: SharedProps) {
  const {search, setSearch, query} = useDocsSearch({client});
  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
