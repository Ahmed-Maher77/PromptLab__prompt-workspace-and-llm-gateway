import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  let httpTesting: HttpTestingController;

  const publicHealth = (availability: string) => ({
    status: 'ok',
    timestamp: '2026-10-23T00:00:00Z',
    uptimeSeconds: 10,
    version: '0.1.0',
    services: {
      database: { status: 'connected', latencyMs: 2 },
      gateway: { serviceAvailability: availability },
    },
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  function statusEls(root: HTMLElement) {
    return {
      text: root.querySelector('.footer-status-text') as HTMLElement,
      dot: root.querySelector('.status-pulse-dot') as HTMLElement,
    };
  }

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'PromptLab' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('PromptLab');
  });

  it('should render the brand title in header', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-title')?.textContent).toContain('PromptLab');
  });

  it('shows a neutral checking state before the first response', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    tick(0);
    httpTesting.expectOne('/api/health');
    fixture.detectChanges();

    const { text, dot } = statusEls(fixture.nativeElement);
    expect(text.textContent?.trim()).toBe('Checking…');
    expect(text.getAttribute('aria-live')).toBe('polite');
    expect(dot.classList.contains('online')).toBe(false);
    expect(dot.classList.contains('unreachable')).toBe(false);
    fixture.destroy();
  }));

  it('shows the gateway as online and pulses only then', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    tick(0);
    httpTesting.expectOne('/api/health').flush(publicHealth('available'));
    fixture.detectChanges();

    const { text, dot } = statusEls(fixture.nativeElement);
    expect(text.textContent?.trim()).toBe('Gateway online');
    expect(dot.classList.contains('online')).toBe(true);
    fixture.destroy();
  }));

  it('shows the gateway as unreachable when the probe reports it down', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    tick(0);
    httpTesting.expectOne('/api/health').flush(publicHealth('unreachable'));
    fixture.detectChanges();

    const { text, dot } = statusEls(fixture.nativeElement);
    expect(text.textContent?.trim()).toBe('Gateway unreachable');
    expect(dot.classList.contains('online')).toBe(false);
    expect(dot.classList.contains('unreachable')).toBe(true);
    fixture.destroy();
  }));

  it('shows the gateway as unreachable when the health request fails', fakeAsync(() => {
    spyOn(console, 'error');
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    tick(0);
    httpTesting
      .expectOne('/api/health')
      .flush('boom', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(statusEls(fixture.nativeElement).text.textContent?.trim()).toBe('Gateway unreachable');
    fixture.destroy();
  }));

  it('polls the health endpoint every 30 seconds and stops on destroy', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    tick(0);
    httpTesting.expectOne('/api/health').flush(publicHealth('available'));
    tick(30_000);
    httpTesting.expectOne('/api/health').flush(publicHealth('unreachable'));
    fixture.detectChanges();

    expect(statusEls(fixture.nativeElement).text.textContent?.trim()).toBe('Gateway unreachable');

    fixture.destroy();
    tick(60_000);
    httpTesting.expectNone('/api/health');
  }));

  it('renders accessible fallback initials instead of hard-coded ones', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const avatar = (fixture.nativeElement as HTMLElement).querySelector('.user-avatar')!;
    expect(avatar.textContent?.trim()).toBe('DV');
    expect(avatar.getAttribute('aria-label')).toBe('Developer avatar');
  });
});
