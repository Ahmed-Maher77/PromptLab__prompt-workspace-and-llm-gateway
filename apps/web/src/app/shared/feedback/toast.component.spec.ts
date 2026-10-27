import { TestBed } from '@angular/core/testing';
import { ToastComponent } from './toast.component';
import { ToastService } from './toast.service';

describe('ToastComponent', () => {
  it('uses role=alert for errors and role=status otherwise', () => {
    const fixture = TestBed.createComponent(ToastComponent);
    const service = TestBed.inject(ToastService);
    service.info('fyi');
    service.error('bad');
    fixture.detectChanges();

    const toasts = (fixture.nativeElement as HTMLElement).querySelectorAll('.toast');
    expect(toasts[0].getAttribute('role')).toBe('status');
    expect(toasts[1].getAttribute('role')).toBe('alert');

    (toasts[0].querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.toast').length).toBe(1);
    service.dismiss(service.toasts()[0].id);
  });
});
