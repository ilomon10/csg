import {ContributeCta} from '@/components/landing/contribute-cta';
import {Features} from '@/components/landing/features';
import {Hero} from '@/components/landing/hero';
import {HowItWorks} from '@/components/landing/how-it-works';
import {OpenSource} from '@/components/landing/open-source';
import {Parade} from '@/components/landing/parade';
import {SiteFooter} from '@/components/landing/site-footer';
import {pageMetadata} from '@/lib/seo';

export const metadata = pageMetadata({route: '/'});

export default function HomePage() {
  return (
    <>
      <div id="main-content" className="flex flex-col">
        <Hero />
        <HowItWorks />
        <Features />
        <Parade />
        <OpenSource />
        <ContributeCta />
      </div>
      <SiteFooter />
    </>
  );
}
