import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

describe('LoginComponent (SEC-01b)', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['setToken', 'clearToken', 'getToken']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('displays error message when submitting empty token', () => {
    component.tokenInput = '   ';
    component.onSubmit();
    expect(component.errorMessage).toContain('Please enter an API Key');
    expect(authServiceSpy.setToken).not.toHaveBeenCalled();
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('saves token and navigates to overview on valid input', () => {
    component.tokenInput = 'valid-custom-api-key';
    component.onSubmit();
    expect(authServiceSpy.setToken).toHaveBeenCalledWith('valid-custom-api-key');
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/']);
  });
});
