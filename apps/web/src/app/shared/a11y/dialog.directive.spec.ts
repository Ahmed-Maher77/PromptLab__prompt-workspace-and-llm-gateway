import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogDirective } from './dialog.directive';

@Component({
  standalone: true,
  imports: [DialogDirective],
  template: `
    <button id="opener" type="button" (click)="open.set(true)">Open</button>
    @if (open()) {
      <div id="panel" appDialog="dlg-title" (dialogClose)="onClose()">
        <h2 id="dlg-title">Title</h2>
        <button id="first" type="button">First</button>
        <button id="last" type="button">Last</button>
      </div>
    }
  `,
})
class HostComponent {
  open = signal(false);
  closed = 0;
  onClose(): void {
    this.closed++;
    this.open.set(false);
  }
}

describe('DialogDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let root: HTMLElement;

  const q = (sel: string) => root.querySelector(sel) as HTMLElement;
  const key = (el: HTMLElement, k: string, shiftKey = false) => {
    const ev = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    root = fixture.nativeElement;
    document.body.appendChild(root);
    fixture.detectChanges();
    q('#opener').focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
  });

  afterEach(() => root.remove());

  it('sets dialog role and aria attributes', () => {
    const panel = q('#panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe('dlg-title');
  });

  it('moves focus to the first focusable element', () => {
    expect(document.activeElement).toBe(q('#first'));
  });

  it('wraps Tab from the last element to the first', () => {
    q('#last').focus();
    const ev = key(q('#last'), 'Tab');
    expect(ev.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(q('#first'));
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    q('#first').focus();
    const ev = key(q('#first'), 'Tab', true);
    expect(ev.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(q('#last'));
  });

  it('emits dialogClose on Escape', () => {
    key(q('#first'), 'Escape');
    expect(fixture.componentInstance.closed).toBe(1);
  });

  it('restores focus to the previously focused element on destroy', () => {
    key(q('#first'), 'Escape');
    fixture.detectChanges();
    expect(q('#panel')).toBeNull();
    expect(document.activeElement).toBe(q('#opener'));
  });
});
