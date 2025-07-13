import { Prompt } from './types.js';

/**
 * Definitions for all available prompts
 */
export const promptDefinitions: Prompt[] = [
  {
    name: 'execute_card',
    description:
      'Execute a Metabase card/question with intelligent parameter handling and display results',
    arguments: [
      {
        name: 'card_id',
        description: 'The ID number of the Metabase card/question to execute',
        required: true,
      },
      {
        name: 'filters',
        description:
          'Natural language description of any filter values or conditions to apply to the card execution',
        required: false,
      },
    ],
  },
  {
    name: 'export_card',
    description:
      'Export a Metabase card/question to file with intelligent parameter handling and troubleshooting',
    arguments: [
      {
        name: 'card_id',
        description: 'The ID number of the Metabase card/question to export',
        required: true,
      },
      {
        name: 'filters',
        description:
          'Natural language description of any filter values or conditions to apply to the card export',
        required: false,
      },
      {
        name: 'file_type',
        description: 'Export format: CSV, JSON, or XLSX',
        required: false,
      },
    ],
  },
];
