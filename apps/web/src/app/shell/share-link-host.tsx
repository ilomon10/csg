import {createNewProjectDocument} from '../viewport';
import type {CharacterSpec} from '@csg/parts-schema';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import {OpenSharedDialog, clearShareFragment} from '../../features/composer';
import {announce, toastQueue} from '../../shared/ui';
import {decodeShareFragment} from '../../shared/share';
import type {ShellServices} from './services';
import {useShell} from './shell-context';

/** The raw `#c=` payload of a hash (any characters; the codec validates it), or null. */
export function sharePayloadOf(hash: string): string | null {
  if (!hash.startsWith('#c=')) return null;
  const payload = hash.slice(3);
  return payload === '' ? null : payload;
}

/**
 * Handles a `#c=` link (REQ-CMP-034, REQ-CMP-035): decodes and validates the payload, then asks
 * before opening. Invalid or oversized payloads show the codec's error with its code and go home.
 * The fragment is removed after either answer, so a reload does not ask again.
 *
 * @returns The decoded character awaiting confirmation (or `null`) and the two answers.
 */
export function useShareLink(services: ShellServices): {
  readonly spec: CharacterSpec | null;
  openAsNew(spec: CharacterSpec): Promise<void>;
  cancel(): void;
} {
  const {win, router} = services;
  const [spec, setSpec] = useState<CharacterSpec | null>(null);
  const token = useRef(0);

  const finish = useCallback(
    async (target: Parameters<typeof router.navigate>[0]) => {
      clearShareFragment(win);
      await router.navigate(target, {replace: true});
    },
    [win, router],
  );

  useEffect(() => {
    const check = async (): Promise<void> => {
      const payload = sharePayloadOf(win.location.hash);
      if (payload === null) return;
      const mine = ++token.current;
      await services.start();
      const decoded = await decodeShareFragment(payload);
      if (mine !== token.current) return;
      if (decoded.ok) {
        setSpec(decoded.value);
        return;
      }
      services.diagnostics.recordError(decoded.error.code);
      toastQueue.push({
        message: decoded.error.message,
        tone: 'error',
        code: decoded.error.code,
      });
      announce(`${decoded.error.code}: ${decoded.error.message}`, 'assertive');
      await finish({view: 'home'});
    };
    void check();
    const onHash = () => void check();
    win.addEventListener('hashchange', onHash);
    return () => {
      win.removeEventListener('hashchange', onHash);
      token.current++;
    };
  }, [win, services, finish]);

  const openAsNew = useCallback(
    async (shared: CharacterSpec) => {
      const repo = services.repo();
      if (repo === null) {
        services.reportError('UX_STORAGE_UNAVAILABLE', 'error');
        setSpec(null);
        await finish({view: 'home'});
        return;
      }
      const projectId = globalThis.crypto.randomUUID();
      const saved = await repo.put({
        format: 'sprite-project-record',
        version: 1,
        meta: {
          projectId,
          name: shared.name.slice(0, 64),
          lastEditedAt: Date.now(),
          pinned: false,
        },
        doc: createNewProjectDocument(shared),
      });
      setSpec(null);
      if (!saved.ok) {
        services.reportError(saved.error.code, 'error');
        await finish({view: 'home'});
        return;
      }
      await finish({view: 'project', projectId});
    },
    [services, finish],
  );

  const cancel = useCallback(() => {
    setSpec(null);
    void finish({view: 'home'});
  }, [finish]);

  return {spec, openAsNew, cancel};
}

/** Confirmation dialog of a `#c=` link (REQ-CMP-035); Cancel has the initial focus. */
export function ShareLinkHost(): ReactElement {
  const services = useShell();
  const {spec, openAsNew, cancel} = useShareLink(services);
  return (
    <OpenSharedDialog
      open={spec !== null}
      spec={spec}
      onOpenAsNew={s => void openAsNew(s)}
      onCancel={cancel}
    />
  );
}
