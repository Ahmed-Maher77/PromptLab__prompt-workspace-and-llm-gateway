import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmService } from './confirm.service';
import { ConfirmDialogComponent } from './confirm-dialog.component';

describe('ConfirmService', () => {
  let service: ConfirmService;

  beforeEach(() => {
    service = TestBed.inject(ConfirmService);
  });

  it('resolves true when confirmed', async () => {
    const result = service.confirm('Sure?');
    expect(service.request()?.message).toBe('Sure?');
    service.respond(true);
    expect(await result).toBeTrue();
    expect(service.request()).toBeNull();
  });

  it('resolves false when cancelled', async () => {
    const result = service.confirm({ message: 'Sure?' });
    service.respond(false);
    expect(await result).toBeFalse();
  });

  it('cancels a pending request when a new one arrives', async () => {
    const first = service.confirm('one');
    const second = service.confirm('two');
    expect(await first).toBeFalse();
    service.respond(true);
    expect(await second).toBeTrue();
  });
});

describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let service: ConfirmService;

  beforeEach(() => {
    fixture = TestBed.createComponent(ConfirmDialogComponent);
    document.body.appendChild(fixture.nativeElement);
    service = TestBed.inject(ConfirmService);
    fixture.detectChanges();
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('renders nothing when idle', () => {
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders a labelled dialog and confirms on click', async () => {
    const result = service.confirm({ title: 'Delete it', message: 'Really?', confirmLabel: 'Yes' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('#confirm-dialog-title')?.textContent).toContain('Delete it');
    expect(document.activeElement?.textContent).toContain('Cancel');

    const buttons = el.querySelectorAll('button');
    (buttons[1] as HTMLButtonElement).click();
    expect(await result).toBeTrue();
  });

  it('cancels on Escape', async () => {
    const result = service.confirm('Really?');
    fixture.detectChanges();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="dialog"]',
    ) as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await result).toBeFalse();
  });
});
