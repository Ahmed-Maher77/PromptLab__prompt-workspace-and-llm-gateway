import { DEFAULT_DEV_USER } from '../common/constants/auth.constants';
import { REFERENCE_PROMPTS } from './reference-prompts';
import { seedDemoData } from './seed';

describe('seedDemoData', () => {
  const makePrisma = (existingNames: string[] = []) => ({
    user: { upsert: jest.fn().mockResolvedValue({ id: DEFAULT_DEV_USER.id }) },
    prompt: {
      findFirst: jest.fn(({ where }: { where: { name: string } }) =>
        Promise.resolve(existingNames.includes(where.name) ? { id: 'p' } : null),
      ),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
    },
  });

  it('upserts the default user without overwriting it', async () => {
    const prisma = makePrisma();
    await seedDemoData(prisma as any);
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: DEFAULT_DEV_USER.id },
      update: {},
      create: { ...DEFAULT_DEV_USER },
    });
  });

  it('creates every reference prompt with an immutable v1 on an empty database', async () => {
    const prisma = makePrisma();
    const result = await seedDemoData(prisma as any);

    expect(result.created).toEqual(REFERENCE_PROMPTS.map((p) => p.name));
    expect(prisma.prompt.create).toHaveBeenCalledTimes(REFERENCE_PROMPTS.length);
    const first = prisma.prompt.create.mock.calls[0][0].data;
    expect(first.owner).toEqual({ connect: { id: DEFAULT_DEV_USER.id } });
    expect(first.techniqueMetadata).toEqual({ techniques: REFERENCE_PROMPTS[0].techniques });
    expect(first.versions.create).toMatchObject({
      versionNumber: 1,
      templateBody: REFERENCE_PROMPTS[0].templateBody,
      createdBy: DEFAULT_DEV_USER.id,
    });
  });

  it('is idempotent: existing prompts are skipped, never duplicated or modified', async () => {
    const prisma = makePrisma(REFERENCE_PROMPTS.map((p) => p.name));
    const result = await seedDemoData(prisma as any);
    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(REFERENCE_PROMPTS.length);
    expect(prisma.prompt.create).not.toHaveBeenCalled();
  });

  it('derives variables from the template when none are declared', async () => {
    const prisma = makePrisma();
    await seedDemoData(prisma as any, [{ name: 'T', templateBody: 'Hi {{ name }}, see {{topic}} and {{name}}' }]);
    expect(prisma.prompt.create.mock.calls[0][0].data.versions.create.variables).toEqual([
      { name: 'name', required: true },
      { name: 'topic', required: true },
    ]);
  });

  it('ships reference prompts whose declared variables all appear in their templates', () => {
    for (const p of REFERENCE_PROMPTS) {
      for (const v of p.variables ?? []) {
        expect(p.templateBody).toContain(`{{${v.name}}}`);
      }
    }
  });
});
