import { generateRequestId } from '../../utils/index.js';
import { ErrorCode, McpError } from '../../types/core.js';
import { MetabaseApiClient } from '../../api.js';
import { promptDefinitions } from './promptDefinitions.js';
import {
  generateCardExecutionWorkflowPrompt,
  generateCardExportWorkflowPrompt,
} from './promptGenerators.js';
import { ListPromptsRequest, GetPromptRequest, Prompt, LogFunction } from './types.js';

/**
 * Handle listing all available prompts
 */
export async function handleListPrompts(_request: ListPromptsRequest, logInfo: LogFunction) {
  logInfo('Processing request to list available prompts');

  const prompts: Prompt[] = promptDefinitions.map(prompt => ({
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments,
  }));

  return { prompts };
}

/**
 * Handle getting a specific prompt
 */
export async function handleGetPrompt(
  request: GetPromptRequest,
  apiClient: MetabaseApiClient,
  logInfo: LogFunction,
  logWarn: LogFunction,
  logError: LogFunction
) {
  const requestId = generateRequestId();
  const promptName = request.params?.name;
  const args = request.params?.arguments || {};

  logInfo(`Processing prompt request: ${promptName}`, { requestId, arguments: args });

  await apiClient.getSessionToken();

  try {
    switch (promptName) {
      case 'execute_card':
        return generateCardExecutionWorkflowPrompt(args, apiClient, logInfo, logWarn);

      case 'export_card':
        return generateCardExportWorkflowPrompt(args, apiClient, logInfo, logWarn);

      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${promptName}`);
    }
  } catch (error) {
    logError(`Failed to generate prompt: ${promptName}`, error);
    throw error;
  }
}
