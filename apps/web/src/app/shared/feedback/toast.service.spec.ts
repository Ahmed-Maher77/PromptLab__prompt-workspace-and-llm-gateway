import { fakeAsync, tick, TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    service = TestBed.inject(ToastService);
  });

  it('adds toasts of each kind', () => {
    service.info('a');
    service.success('b');
    service.error('c');
    expect(service.toasts().map((t) => t.kind)).toEqual(['info', 'success', 'error']);
  });

  it('dismisses a toast by id', fakeAsync(() => {
    const id = service.info('a');
    service.dismiss(id);
    expect(service.toasts().length).toBe(0);
  }));

  it('auto-dismisses after its duration', fakeAsync(() => {
    service.info('a');
    tick(4999);
    expect(service.toasts().length).toBe(1);
    tick(1);
    expect(service.toasts().length).toBe(0);
  }));

  it('keeps errors visible longer', fakeAsync(() => {
    service.error('boom');
    tick(5000);
    expect(service.toasts().length).toBe(1);
    tick(3000);
    expect(service.toasts().length).toBe(0);
  }));

  it('clears pending timers when destroyed', fakeAsync(() => {
    service.info('a');
    TestBed.resetTestingModule();
    // No timers should remain pending; fakeAsync fails the test otherwise.
  }));
});
