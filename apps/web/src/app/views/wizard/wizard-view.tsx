import {t} from '../../../shared/i18n';
import {createDefaultCharacterSpec} from '@csg/parts-schema';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {ReactElement} from 'react';
import {useCharacterSpec} from '../../../features/composer';
import type {Catalog} from '../../../shared/catalog';
import {createDraftTarget, freshSeed} from '../../../shared/document';
import {Button, Dialog, IconButton, announce} from '../../../shared/ui';
import {createViewportStore} from '../../../shared/viewport';
import {
  CharacterViewport,
  createNewProjectDocument,
  createPreviewSettings,
} from '../../viewport';
import {useShell} from '../../shell/shell-context';
import './wizard.css';
import {WizardStepPanel} from './wizard-step-panel';
import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  randomizeStep,
  skipStep,
} from './wizard-steps';

/** Props of {@link WizardView}. */
export interface WizardViewProps {
  /** Seed source for Randomize; a fresh seed per roll by default. Inject a constant in tests. */
  readonly seed?: () => number;
}

/**
 * The new-character wizard (spec 014 REQ-UX-089..100): eight steps on an in-memory
 * {@link DraftTarget}, a live preview, Back / Randomize / Skip / Next and a discard guard.
 * Waits for the catalog; nothing is persisted until Finish.
 */
export function WizardView({seed = freshSeed}: WizardViewProps): ReactElement {
  const {catalog: store} = useShell();
  const catalog = useSyncExternalStore(
    store.subscribe,
    () => store.get().catalog,
  );
  if (catalog === null) {
    return (
      <p className="wz-status" role="status">
        {t('wiz.loading')}
      </p>
    );
  }
  return <WizardBody catalog={catalog} seed={seed} />;
}

function WizardBody({
  catalog,
  seed,
}: {
  readonly catalog: Catalog;
  readonly seed: () => number;
}): ReactElement {
  const services = useShell();
  const {router, registry} = services;
  const [start] = useState(() => createDefaultCharacterSpec());
  const [draft] = useState(() => createDraftTarget(start, () => catalog));
  const [viewport] = useState(() => createViewportStore());
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const spec = useCharacterSpec(draft);
  const heading = useRef<HTMLHeadingElement>(null);
  // `Button` takes no ref; the dialog reads the safe default (Keep editing) by id on open.
  const [keep] = useState<{readonly current: HTMLElement | null}>(() => ({
    get current() {
      return document.getElementById('wz-keep');
    },
  }));
  const bypass = useRef(false);
  const nameRef = useRef(name);
  nameRef.current = name;

  const changed = useCallback(
    () => !draft.isPristine() || nameRef.current.trim() !== '',
    [draft],
  );

  // Step change: move focus to the heading so it is announced (REQ-UX-095).
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const leave = useCallback(async () => {
    bypass.current = true;
    const ok = await router.navigate({view: 'home'});
    if (!ok) bypass.current = false;
  }, [router]);

  // Escape, Close and Back out of the wizard (REQ-UX-098); a hand-edited fragment is cancelled
  // by the same guard and the router restores `#new`.
  const requestExit = useCallback(() => {
    if (changed()) setDiscardOpen(true);
    else void leave();
  }, [changed, leave]);

  useEffect(
    () =>
      router.addGuard(from => {
        if (from.view !== 'wizard' || bypass.current || !changed()) return;
        setDiscardOpen(true);
        return false;
      }),
    [router, changed],
  );

  useEffect(
    () =>
      registry.register([
        {
          id: 'wizard.exit',
          titleKey: 'cmd.wizard.exit',
          category: 'project',
          run: requestExit,
        },
      ]),
    [registry, requestExit],
  );

  const current = WIZARD_STEPS[step] ?? WIZARD_STEPS[0]!;
  const last = step === WIZARD_STEP_COUNT - 1;
  const title = t(current.title);

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    const repo = services.repo();
    if (repo === null) {
      services.reportError('UX_STORAGE_UNAVAILABLE', 'error');
      setFinishing(false);
      return;
    }
    const trimmed = name.trim().slice(0, 64);
    const character = {
      ...draft.getSpec(),
      name: trimmed === '' ? t('wiz.name.placeholder') : trimmed,
    };
    const id = globalThis.crypto.randomUUID();
    const saved = await repo.saveDocument(
      id,
      createNewProjectDocument(character),
    );
    if (!saved.ok) {
      services.reportError(saved.error.code, 'error');
      setFinishing(false);
      return;
    }
    bypass.current = true;
    await router.navigate({view: 'project', projectId: id}, {replace: true});
  };

  const go = (next: number) =>
    setStep(Math.min(WIZARD_STEP_COUNT - 1, Math.max(0, next)));
  const bodyThumbnail = catalog.parts.find(
    p => p.ref === spec.body.ref,
  )?.thumbnailUrl;

  return (
    <section className="wz" aria-label={t('wiz.label')} data-step={current.id}>
      <div className="wz-preview">
        <p className="wz-nametag" data-testid="wizard-nametag">
          {name.trim() === '' ? t('wiz.name.placeholder') : name.trim()}
        </p>
        <CharacterViewport
          target={draft}
          render={createPreviewSettings}
          label={t('wiz.preview')}
          variant="wizard"
          store={viewport}
          onBackend={backend => services.diagnostics.reportRenderer({backend})}
          {...(bodyThumbnail === undefined
            ? {}
            : {placeholderUrl: bodyThumbnail})}
        />
      </div>
      <div className="wz-panel">
        <div className="wz-top">
          <IconButton
            icon="x"
            label={t('wiz.close')}
            onClick={requestExit}
            aria-keyshortcuts="Escape"
          />
          <p className="wz-top__title">{t('wiz.label')}</p>
        </div>
        <nav aria-label={t('wiz.progress')}>
          <ol className="wz-stepper">
            {WIZARD_STEPS.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="wz-seg"
                  data-state={
                    i < step ? 'done' : i === step ? 'current' : 'todo'
                  }
                  aria-current={i === step ? 'step' : undefined}
                  aria-label={t('wiz.stepLink', {
                    n: i + 1,
                    title: t(s.title),
                  })}
                  onClick={() => go(i)}
                >
                  <span className="wz-seg__pip" aria-hidden="true" />
                  <span className="wz-seg__name" aria-hidden="true">
                    {t(s.title)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="wz-body">
          <div className="wz-step" key={current.id}>
            <h2
              ref={heading}
              className="wz-heading"
              tabIndex={-1}
              aria-label={t('wiz.stepHeading', {
                n: step + 1,
                total: WIZARD_STEP_COUNT,
                title,
              })}
            >
              <span className="wz-heading__eyebrow" aria-hidden="true">
                {t('wiz.stepOf', {n: step + 1, total: WIZARD_STEP_COUNT})}
              </span>
              <span className="wz-heading__title" aria-hidden="true">
                {title}
              </span>
            </h2>
            <p className="wz-sub">{t(current.subtitle)}</p>
            <WizardStepPanel
              step={current}
              catalog={catalog}
              target={draft}
              name={name}
              onName={setName}
              onSubmit={() => void finish()}
            />
          </div>
        </div>
        <div className="wz-foot">
          {step > 0 ? (
            <Button icon="chevron-left" onClick={() => go(step - 1)}>
              {t('wiz.back')}
            </Button>
          ) : null}
          {!last ? (
            <IconButton
              icon="dice"
              label={t('wiz.randomize')}
              onClick={() => {
                randomizeStep(draft, catalog, current, seed());
                announce(t('wiz.randomized', {title}));
              }}
            />
          ) : null}
          <span className="wz-foot__grow" />
          {!last ? (
            <Button
              variant="ghost"
              onClick={() => {
                skipStep(draft, catalog, current, start);
                announce(t('wiz.skipped', {title}));
                go(step + 1);
              }}
            >
              {t('wiz.skip')}
            </Button>
          ) : null}
          {last ? (
            <Button
              variant="primary"
              disabled={finishing}
              onClick={() => void finish()}
            >
              {finishing ? t('wiz.finishing') : t('wiz.finish')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => go(step + 1)}>
              {t('wiz.next')}
            </Button>
          )}
        </div>
      </div>
      <Dialog
        open={discardOpen}
        title={t('wiz.discard.title')}
        role="alertdialog"
        initialFocus={keep}
        onClose={() => setDiscardOpen(false)}
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => {
                setDiscardOpen(false);
                void leave();
              }}
            >
              {t('wiz.discard.confirm')}
            </Button>
            <Button
              id="wz-keep"
              variant="primary"
              onClick={() => setDiscardOpen(false)}
            >
              {t('wiz.discard.keep')}
            </Button>
          </>
        }
      >
        <p>{t('wiz.discard.body')}</p>
      </Dialog>
    </section>
  );
}
