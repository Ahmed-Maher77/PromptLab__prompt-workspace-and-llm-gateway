import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AUTH_CONFIG, validateEnvironment } from './env.validation';

/**
 * Global module providing the validated APP_CONFIG and AUTH_CONFIG application-wide.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => validateEnvironment(),
    },
    {
      provide: AUTH_CONFIG,
      useExisting: APP_CONFIG,
    },
  ],
  exports: [APP_CONFIG, AUTH_CONFIG],
})
export class AppConfigModule {}

export { AppConfigModule as AuthConfigModule };
