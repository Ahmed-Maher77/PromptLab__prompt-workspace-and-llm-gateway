import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_DEV_USER } from '../common/constants/auth.constants';
import { CreatePromptDto } from '../prompts/dto/create-prompt.dto';
import { REFERENCE_PROMPTS } from './reference-prompts';

type SeedClient = Pick<PrismaClient, 'user' | 'prompt'>;

export interface SeedResult {
  created: string[];
  skipped: string[];
}

/** Template variables written as `{{ name }}`, used when a reference prompt declares none. */
function extractVariables(templateBody: string): string[] {
  const names = new Set<string>();
  for (const match of templateBody.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) names.add(match[1]);
  return [...names];
}

function promptCreateInput(dto: CreatePromptDto, ownerId: string): Prisma.PromptCreateInput {
  const variables =
    dto.variables && dto.variables.length > 0
      ? dto.variables
      : extractVariables(dto.templateBody).map((name) => ({ name, required: true }));

  return {
    owner: { connect: { id: ownerId } },
    name: dto.name,
    description: dto.description || null,
    techniqueMetadata: { techniques: dto.techniques || ['zero-shot'] },
    versions: {
      create: {
        versionNumber: 1,
        templateBody: dto.templateBody,
        variables: variables as unknown as Prisma.InputJsonValue,
        examples: (dto.examples || []) as unknown as Prisma.InputJsonValue,
        outputSchema: (dto.outputSchema ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
        modelDefaults: (dto.modelDefaults || { model: 'gpt-4o-mini' }) as unknown as Prisma.InputJsonValue,
        createdBy: ownerId,
      },
    },
  };
}

/**
 * Creates the default developer user and the reference prompt templates.
 * Idempotent: the user is upserted and a prompt is only created if the user has none with that name,
 * so running it again (or on every container start) never duplicates data or touches user edits.
 */
export async function seedDemoData(
  prisma: SeedClient,
  prompts: CreatePromptDto[] = REFERENCE_PROMPTS,
): Promise<SeedResult> {
  await prisma.user.upsert({
    where: { id: DEFAULT_DEV_USER.id },
    update: {},
    create: { ...DEFAULT_DEV_USER },
  });

  const result: SeedResult = { created: [], skipped: [] };
  for (const dto of prompts) {
    const existing = await prisma.prompt.findFirst({
      where: { ownerId: DEFAULT_DEV_USER.id, name: dto.name },
      select: { id: true },
    });
    if (existing) {
      result.skipped.push(dto.name);
      continue;
    }
    await prisma.prompt.create({ data: promptCreateInput(dto, DEFAULT_DEV_USER.id) });
    result.created.push(dto.name);
  }
  return result;
}

async function main(): Promise<void> {
  const logger = new Logger('Seed');
  const prisma = new PrismaClient();
  try {
    const { created, skipped } = await seedDemoData(prisma);
    logger.log(`Reference prompts created: ${created.length}, already present: ${skipped.length}.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    new Logger('Seed').error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
