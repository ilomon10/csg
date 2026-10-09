import {t} from '../../shared/i18n';
import {Component, Fragment} from 'react';
import type {ErrorInfo, ReactNode} from 'react';
import {Button, announce} from '../../shared/ui';
import {clearCrash} from './crash-hooks';

/** Error code of a crashed region (REQ-UX-043). */
export const PANEL_CRASHED = 'UX_PANEL_CRASHED';
/** Error code of a crash that escaped every region (REQ-UX-044). */
export const SHELL_CRASHED = 'UX_SHELL_CRASHED';

interface Props {
  readonly kind: 'region' | 'root';
  /** Region name for the report; no stack trace is ever shown. */
  readonly name: string;
  readonly children: ReactNode;
  /** Called once per crash with the error code (diagnostics log). */
  readonly onCrash?: (code: string) => void;
  /** Plain-text diagnostic report (no project content). */
  readonly report?: () => string;
  /** Root only: downloads the backup; resolves false when there is nothing to back up. */
  readonly downloadBackup?: () => Promise<boolean>;
  /** Root only: reloads the page. */
  readonly reload?: () => void;
}

interface State {
  readonly failed: boolean;
  readonly attempt: number;
  readonly note: string | null;
}

/**
 * Error boundary for one region or the whole shell. A region shows "This panel stopped
 * working" with its code and a reload; the root shows a full-window fallback with a project
 * backup (REQ-UX-043, REQ-UX-044). Never renders a stack trace.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = {failed: false, attempt: 0, note: null};

  static getDerivedStateFromError(): Partial<State> {
    return {failed: true};
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.onCrash?.(
      this.props.kind === 'root' ? SHELL_CRASHED : PANEL_CRASHED,
    );
  }

  private copyReport = async (): Promise<void> => {
    const text =
      this.props.report?.() ?? `${PANEL_CRASHED} region=${this.props.name}`;
    try {
      await navigator.clipboard.writeText(text);
      this.setState({note: t('crash.copied')});
      announce(t('crash.copied'));
    } catch {
      this.setState({note: text});
    }
  };

  private backup = async (): Promise<void> => {
    const done = (await this.props.downloadBackup?.()) ?? false;
    this.setState({note: done ? null : t('crash.root.noBackup')});
  };

  override render(): ReactNode {
    if (!this.state.failed) {
      return (
        <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
      );
    }
    const root = this.props.kind === 'root';
    return (
      <div
        className={root ? 'shell-crash shell-crash--root' : 'shell-crash'}
        role="alert"
        data-testid={root ? 'root-fallback' : 'region-fallback'}
        data-region={root ? undefined : this.props.name}
      >
        <h2 className="shell-crash__title">
          {t(root ? 'crash.root.title' : 'crash.region.title')}
        </h2>
        <p className="csg-mono">{root ? SHELL_CRASHED : PANEL_CRASHED}</p>
        <div className="shell-crash__actions">
          {root ? (
            <>
              <Button
                variant="primary"
                small
                style={{minWidth: 0}}
                onClick={() => this.props.reload?.()}
              >
                {t('crash.root.reload')}
              </Button>
              <Button onClick={() => void this.backup()}>
                {t('crash.root.backup')}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                clearCrash('region', this.props.name);
                this.setState(s => ({
                  failed: false,
                  attempt: s.attempt + 1,
                  note: null,
                }));
              }}
            >
              {t('crash.region.reload')}
            </Button>
          )}
          {root ? null : (
            <Button variant="ghost" onClick={() => void this.copyReport()}>
              {t('crash.copy')}
            </Button>
          )}
        </div>
        {this.state.note === null ? null : (
          <p role="status">{this.state.note}</p>
        )}
      </div>
    );
  }
}
