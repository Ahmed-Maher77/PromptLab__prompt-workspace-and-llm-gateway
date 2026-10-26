import { CreatePromptDto } from '../prompts/dto/create-prompt.dto';

/**
 * Reference prompt templates loaded by `npm run seed` (and by the Docker entrypoint when
 * SEED_DEMO_DATA=true) so a fresh environment has working examples for each technique.
 */
export const REFERENCE_PROMPTS: CreatePromptDto[] = [
  {
    name: 'Customer Support Inquiry Classifier',
    description: 'Categorizes incoming customer messages with sentiment, urgency, and routing target.',
    techniques: ['zero-shot', 'structured-output'],
    templateBody: `You are an intelligent customer support routing assistant.\nAnalyze the customer inquiry below and classify it into one of the designated categories.\n\nCustomer Inquiry:\n"""\n{{customer_inquiry}}\n"""\n\nFormat your response as a valid JSON object matching the following structure:\n{\n  "category": "Billing" | "Technical Support" | "Account Access" | "Sales Inquiry" | "General Feedback",\n  "urgency": "Low" | "Medium" | "High",\n  "sentiment": "Positive" | "Neutral" | "Negative",\n  "recommendedAction": "short explanation of next step"\n}`,
    variables: [
      {
        name: 'customer_inquiry',
        description: 'The raw text message received from the customer',
        required: true,
        defaultValue: 'I was charged twice for my subscription this month and cannot access my team workspace. Please refund immediately!',
      },
    ],
    modelDefaults: {
      model: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 512,
    },
  },
  {
    name: 'PostgreSQL Query Generator',
    description: 'Transforms natural language analytical queries into optimized PostgreSQL statements.',
    techniques: ['few-shot', 'RTF'],
    templateBody: `Role: Senior PostgreSQL Database Engineer\nTask: Translate natural language requests into performant, clean SQL queries adhering to PostgreSQL syntax.\nFormat: Output only the SQL query enclosed in a single \`\`\`sql code block, without commentary.\n\nDatabase Schema:\nTable "users" (id UUID, email VARCHAR, role VARCHAR, created_at TIMESTAMP)\nTable "prompts" (id UUID, owner_id UUID, name VARCHAR, created_at TIMESTAMP)\nTable "usage_records" (id UUID, user_id UUID, total_tokens INT, created_at TIMESTAMP)\n\nUser Request:\n{{user_request}}`,
    variables: [
      {
        name: 'user_request',
        description: 'Plain English description of the desired database query',
        required: true,
        defaultValue: 'Find the top 5 users who consumed the most tokens during the last 30 days',
      },
    ],
    examples: [
      {
        input: 'Count how many users registered this month',
        output: `\`\`\`sql\nSELECT COUNT(*) AS total_users\nFROM users\nWHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP);\n\`\`\``,
      },
      {
        input: 'List all prompts created by user dev-user-001 ordered newest first',
        output: `\`\`\`sql\nSELECT id, name, created_at\nFROM prompts\nWHERE owner_id = 'dev-user-001'\nORDER BY created_at DESC;\n\`\`\``,
      },
    ],
    modelDefaults: {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 1024,
    },
  },
  {
    name: 'API Endpoint Explainer & Guide',
    description: 'Generates clean developer-friendly endpoint breakdowns with headers and potential errors.',
    techniques: ['RTF', 'custom'],
    templateBody: `Role: Staff Technical Documentation Lead\nTask: Explain the following API endpoint specification for {{target_audience}}.\nFormat: Provide a 2-sentence summary, required request headers, expected HTTP status codes, and common failure scenarios.\n\nEndpoint Definition:\n{{endpoint_spec}}`,
    variables: [
      {
        name: 'endpoint_spec',
        description: 'HTTP method, path, and request/response contract',
        required: true,
        defaultValue: 'POST /v1/chat/completions (Authorization: Bearer <key>, Body: { model: string, messages: array })',
      },
      {
        name: 'target_audience',
        description: 'Audience reading the docs',
        required: true,
        defaultValue: 'Junior Frontend Developers integrating mobile apps',
      },
    ],
    modelDefaults: {
      model: 'gpt-4o-mini',
      temperature: 0.5,
      maxTokens: 768,
    },
  },
];
