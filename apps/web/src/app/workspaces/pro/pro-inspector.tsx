import {t} from '../../../shared/i18n';
import type {MessageKey} from '../../../shared/i18n';
import type {ReactElement} from 'react';
import type {TintSlot} from '@csg/parts-schema';
import {AnatomyPanel} from '../../../features/anatomy';
import {AnimationPanel} from '../../../features/animation';
import {TintColorsPanel} from '../../../features/composer';
import {LookPanel, ProRenderTab} from '../../../features/look';
import type {StructuralTiming} from '../../../features/look';
import type {Catalog} from '../../../shared/catalog';
import type {CharacterTarget, DocumentStore} from '../../../shared/document';
import {Tabs} from '../../../shared/ui';
import type {TabItem} from '../../../shared/ui';
import {sharedViewportStore} from '../../viewport';
import type {InspectorTab} from '../focus-request';
import {ProPartsTab} from './pro-parts-tab';

/** Inspector tabs in order (REQ-UX-004). */
export const INSPECTOR_TABS: readonly InspectorTab[] = [
  'parts',
  'colors',
  'anatomy',
  'render',
  'animation',
];

/** Props of {@link ProInspector}. */
export interface ProInspectorProps {
  readonly catalog: Catalog;
  readonly target: CharacterTarget;
  readonly store: DocumentStore;
  readonly tab: InspectorTab;
  readonly onTab: (tab: InspectorTab) => void;
  readonly timing: StructuralTiming;
  /** Colors-tab control to focus on arrival ("Edit in Pro", AC-UX-055.2). */
  readonly focusChannel?: TintSlot;
}

/** The inspector tabs Parts, Colors, Anatomy, Render and Animation (REQ-UX-004). */
export function ProInspector({
  catalog,
  target,
  store,
  tab,
  onTab,
  timing,
  focusChannel,
}: ProInspectorProps): ReactElement {
  const items: TabItem[] = INSPECTOR_TABS.map(id => ({
    id,
    label: t(`pro.tab.${id}` as MessageKey),
  }));
  const bodyRig = catalog.parts.find(
    p => p.ref === target.getSpec().body.ref,
  )?.rig;
  return (
    <Tabs
      label={t('pro.inspectorTabs')}
      tabs={items}
      value={tab}
      onChange={id => onTab(id as InspectorTab)}
      panelClassName="pro-inspector__panel"
    >
      {active => {
        switch (active) {
          case 'colors':
            return (
              <TintColorsPanel
                target={target}
                catalog={catalog}
                {...(focusChannel ? {focusChannel} : {})}
                onGestureStart={() => store.beginGesture('tint')}
                onGestureEnd={() => store.endGesture()}
              />
            );
          case 'anatomy':
            return (
              <AnatomyPanel target={target} catalog={catalog} gesture={store} />
            );
          case 'render':
            return (
              <>
                <LookPanel
                  store={store}
                  catalog={catalog}
                  timing={timing}
                  presetOnly
                />
                <ProRenderTab store={store} timing={timing} />
              </>
            );
          case 'animation':
            return (
              <AnimationPanel
                store={store}
                catalog={catalog}
                {...(bodyRig ? {bodyRig} : {})}
                viewport={sharedViewportStore}
              />
            );
          default:
            return <ProPartsTab target={target} catalog={catalog} />;
        }
      }}
    </Tabs>
  );
}
