import {
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Dialog semantics and keyboard support for a modal panel or drawer.
 * Apply to the panel element; the element exists only while the dialog is open.
 */
@Directive({
  selector: '[appDialog]',
  standalone: true,
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-labelledby]': 'appDialog() || null',
    '[attr.tabindex]': '-1',
    '(keydown)': 'onKeydown($event)',
  },
})
export class DialogDirective implements AfterViewInit {
  /** Id of the element that labels the dialog. */
  readonly appDialog = input<string>('');
  readonly dialogClose = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly previouslyFocused = this.doc.activeElement as HTMLElement | null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.restoreFocus());
  }

  ngAfterViewInit(): void {
    const target =
      this.host.nativeElement.querySelector<HTMLElement>('[data-autofocus]') ??
      this.focusable()[0] ??
      this.host.nativeElement;
    target.focus();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dialogClose.emit();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const items = this.focusable();
    const panel = this.host.nativeElement;
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.doc.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusable(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  private restoreFocus(): void {
    const el = this.previouslyFocused;
    if (el && el !== this.doc.body && this.doc.contains(el)) {
      el.focus();
    }
  }
}
