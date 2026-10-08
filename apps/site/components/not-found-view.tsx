import Link from 'next/link';
import {editorUrl} from '@/lib/site-config';

const link = 'font-semibold text-accent underline underline-offset-4';

/** 404 page with ways back (REQ-WEB-041). */
export function NotFoundView() {
  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center gap-6 px-4 py-24"
    >
      <h1 className="font-pixel text-[40px] leading-[1.25] text-ink">
        Page not found
      </h1>
      <p className="text-lg text-ink-soft">
        This page does not exist. It may have moved when the docs were
        reorganised.
      </p>
      <ul className="flex flex-col gap-2 text-lg">
        <li>
          <Link className={link} href="/">
            Home
          </Link>
        </li>
        <li>
          <Link className={link} href="/docs/">
            Documentation and search
          </Link>
        </li>
        <li>
          Looking for the editor?{' '}
          <a className={link} href={editorUrl}>
            Go to the editor
          </a>
        </li>
      </ul>
    </main>
  );
}
