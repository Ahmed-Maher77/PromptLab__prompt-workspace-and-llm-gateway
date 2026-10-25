import { Global, Module } from '@nestjs/common';
import { AUTH_CONFIG, validateEnvironment } from './env.validation';

/**
 * Global module providing the validated AUTH_CONFIG application-wide.
 */
@Global()
@Module({
  providers: [
    {
      provide: AUTH_CONFIG,
      useFactory: () => validateEnvironment(),
    },
  ],
  exports: [AUTH_CONFIG],
})
export class AuthConfigModule {}
