import { Test, TestingModule } from '@nestjs/testing';
import { TokensController } from './tokens.controller';
import { TokenCounterService } from './token-counter.service';

describe('TokensController (TOKEN-01)', () => {
  let controller: TokensController;
  let service: TokenCounterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TokensController],
      providers: [TokenCounterService],
    }).compile();

    controller = module.get<TokensController>(TokensController);
    service = module.get<TokenCounterService>(TokenCounterService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('estimates tokens for raw text string', () => {
    const res = controller.estimate({
      model: 'gpt-4o',
      text: 'Hello, world!',
    });

    expect(res.tokens).toBe(4);
    expect(res.method).toBe('tiktoken:o200k_base');
  });

  it('estimates tokens for chat messages with framing overhead', () => {
    const res = controller.estimate({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'Hello' },
      ],
    });

    // 3 framing + 1 role + 1 content + 3 priming = 8
    expect(res.tokens).toBe(8);
    expect(res.method).toBe('tiktoken:o200k_base');
  });

  it('returns approximate method for non-OpenAI models', () => {
    const res = controller.estimate({
      model: 'claude-3-5-sonnet',
      text: 'Hello, world!',
    });

    expect(res.tokens).toBe(4);
    expect(res.method).toBe('approximate:o200k_base');
  });

  describe('DTO validation (TOKEN-01c)', () => {
    it('rejects roles outside system, user, assistant', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { EstimateTokensDto } = await import('./dto/estimate-tokens.dto');

      const dto = plainToInstance(EstimateTokensDto, {
        model: 'gpt-4o',
        messages: [{ role: 'invalid_role', content: 'hello' }],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(errors)).toContain('role must be one of the following values: system, user, assistant');
    });

    it('rejects messages array exceeding 200 items', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { EstimateTokensDto } = await import('./dto/estimate-tokens.dto');

      const messages = Array.from({ length: 201 }, () => ({
        role: 'user',
        content: 'ping',
      }));

      const dto = plainToInstance(EstimateTokensDto, {
        model: 'gpt-4o',
        messages,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints?.arrayMaxSize).toBeDefined();
    });
  });
});
