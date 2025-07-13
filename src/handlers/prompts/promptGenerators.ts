import { ErrorCode, McpError } from '../../types/core.js';
import { MetabaseApiClient } from '../../api.js';
import { LogFunction } from './types.js';
import { getCardExecutionTemplate, getCardExportTemplate } from './templates/index.js';

/**
 * Generate card execution workflow prompt
 */
export async function generateCardExecutionWorkflowPrompt(
  args: Record<string, any>,
  apiClient: MetabaseApiClient,
  logInfo: LogFunction,
  logWarn: LogFunction
) {
  const cardId = args.card_id;
  const userFilters = args.filters;

  if (!cardId) {
    throw new McpError(ErrorCode.InvalidParams, 'card_id is required for card execution workflow');
  }

  logInfo(`Generating card execution workflow prompt for card ${cardId}`);

  let cardDetails = '';
  let parametersInfo = '';
  let queryInfo = '';
  let databaseInfo = '';

  try {
    // Get card details to understand its structure
    const cardResponse = await apiClient.getCard(parseInt(cardId, 10));
    const card = cardResponse.data;

    cardDetails = `**Card Information:**
- ID: ${card.id}
- Name: ${card.name}
- Description: ${card.description || 'No description'}
- Database ID: ${card.database_id}
- Query Type: ${card.dataset_query?.type || 'unknown'}
- Archived: ${card.archived || false}`;

    // Extract parameter information
    if (card.parameters && card.parameters.length > 0) {
      parametersInfo = `\n**Available Parameters:**\n${card.parameters
        .map((param: any) => `- ${param.name} (${param.type}): ${param.slug} - ${param.id}`)
        .join('\n')}`;
    } else {
      parametersInfo = '\n**Parameters:** None defined';
    }

    // Extract query information
    if (card.dataset_query) {
      if (card.dataset_query.type === 'native' && card.dataset_query.native?.query) {
        queryInfo = `\n**Native SQL Query:**\n\`\`\`sql\n${card.dataset_query.native.query}\n\`\`\``;

        if (
          card.dataset_query.native.template_tags &&
          Object.keys(card.dataset_query.native.template_tags).length > 0
        ) {
          queryInfo += `\n**Template Variables:**\n${Object.entries(
            card.dataset_query.native.template_tags
          )
            .map(
              ([key, tag]: [string, any]) =>
                `- {{${key}}} (${tag.type}): ${tag.display_name || key}`
            )
            .join('\n')}`;
        }
      } else {
        queryInfo = `\n**Query Structure:**\n\`\`\`json\n${JSON.stringify(card.dataset_query, null, 2)}\n\`\`\``;
      }
    }

    // Get database information
    if (card.database_id) {
      try {
        const dbResponse = await apiClient.getDatabase(card.database_id);
        databaseInfo = `\n**Database:** ${dbResponse.data.name} (${dbResponse.data.engine})`;
      } catch (error) {
        logWarn('Could not fetch database info for card workflow', error);
        databaseInfo = `\n**Database ID:** ${card.database_id}`;
      }
    }
  } catch (error) {
    logWarn('Could not fetch card details for workflow prompt', error);
    cardDetails = `**Card ID:** ${cardId} (details could not be retrieved)`;
  }

  const userFiltersText = userFilters
    ? `\n**Filter Requirements:**\n"${userFilters}"`
    : '\n**Filter Requirements:** None';

  return {
    description: 'Card Execution Workflow Assistant',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: getCardExecutionTemplate(
            cardId,
            cardDetails,
            databaseInfo,
            parametersInfo,
            queryInfo,
            userFiltersText
          ),
        },
      },
    ],
  };
}

/**
 * Generate card export workflow prompt
 */
export async function generateCardExportWorkflowPrompt(
  args: Record<string, any>,
  apiClient: MetabaseApiClient,
  logInfo: LogFunction,
  logWarn: LogFunction
) {
  const cardId = args.card_id;
  const userFilters = args.filters;
  const fileType = args.file_type || 'csv';

  if (!cardId) {
    throw new McpError(ErrorCode.InvalidParams, 'card_id is required for card export workflow');
  }

  logInfo(`Generating card export workflow prompt for card ${cardId}`);

  let cardDetails = '';
  let parametersInfo = '';
  let queryInfo = '';
  let databaseInfo = '';

  try {
    // Get card details to understand its structure
    const cardResponse = await apiClient.getCard(parseInt(cardId, 10));
    const card = cardResponse.data;

    cardDetails = `**Card Information:**
- ID: ${card.id}
- Name: ${card.name}
- Description: ${card.description || 'No description'}
- Database ID: ${card.database_id}
- Query Type: ${card.dataset_query?.type || 'unknown'}
- Archived: ${card.archived || false}`;

    // Extract parameter information
    if (card.parameters && card.parameters.length > 0) {
      parametersInfo = `\n**Available Parameters:**\n${card.parameters
        .map((param: any) => `- ${param.name} (${param.type}): ${param.slug} - ${param.id}`)
        .join('\n')}`;
    } else {
      parametersInfo = '\n**Parameters:** None defined';
    }

    // Extract query information
    if (card.dataset_query) {
      if (card.dataset_query.type === 'native' && card.dataset_query.native?.query) {
        queryInfo = `\n**Native SQL Query:**\n\`\`\`sql\n${card.dataset_query.native.query}\n\`\`\``;

        if (
          card.dataset_query.native.template_tags &&
          Object.keys(card.dataset_query.native.template_tags).length > 0
        ) {
          queryInfo += `\n**Template Variables:**\n${Object.entries(
            card.dataset_query.native.template_tags
          )
            .map(
              ([key, tag]: [string, any]) =>
                `- {{${key}}} (${tag.type}): ${tag.display_name || key}`
            )
            .join('\n')}`;
        }
      } else {
        queryInfo = `\n**Query Structure:**\n\`\`\`json\n${JSON.stringify(card.dataset_query, null, 2)}\n\`\`\``;
      }
    }

    // Get database information
    if (card.database_id) {
      try {
        const dbResponse = await apiClient.getDatabase(card.database_id);
        databaseInfo = `\n**Database:** ${dbResponse.data.name} (${dbResponse.data.engine})`;
      } catch (error) {
        logWarn('Could not fetch database info for card workflow', error);
        databaseInfo = `\n**Database ID:** ${card.database_id}`;
      }
    }
  } catch (error) {
    logWarn('Could not fetch card details for export workflow prompt', error);
    cardDetails = `**Card ID:** ${cardId} (details could not be retrieved)`;
  }

  const userFiltersText = userFilters
    ? `\n**Filter Requirements:**\n"${userFilters}"`
    : '\n**Filter Requirements:** None';

  return {
    description: 'Card Export Workflow Assistant',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: getCardExportTemplate(
            cardId,
            fileType,
            cardDetails,
            databaseInfo,
            parametersInfo,
            queryInfo,
            userFiltersText
          ),
        },
      },
    ],
  };
}
