import {
  type LanguageModelV2CallWarning,
  type LanguageModelV2Prompt,
  type LanguageModelV2ToolCallPart,
  type SharedV2ProviderOptions,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import {
  convertToBase64,
  parseProviderOptions,
  validateTypes,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import {
<<<<<<< HEAD
=======
  applyPatchInputSchema,
  applyPatchOutputSchema,
} from '../tool/apply-patch';
import { computerInputSchema, computerOutputSchema } from '../tool/computer';
import {
>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290))
  localShellInputSchema,
  localShellOutputSchema,
} from '../tool/local-shell';
import { webSearchOutputSchema } from '../tool/web-search';
import type {
  OpenAIResponsesFunctionCallOutput,
  OpenAIResponsesInput,
  OpenAIResponsesReasoning,
} from './openai-responses-api';

type OpenAIPromptCacheBreakpoint = { mode: 'explicit' };

function getPromptCacheBreakpoint(
  providerOptions: SharedV2ProviderOptions | undefined,
): OpenAIPromptCacheBreakpoint | undefined {
  return providerOptions?.openai?.promptCacheBreakpoint as
    | OpenAIPromptCacheBreakpoint
    | undefined;
}

/**
 * Check if a string is a file ID based on the given prefixes
 * Returns false if prefixes is undefined (disables file ID detection)
 */
function isFileId(data: string, prefixes?: readonly string[]): boolean {
  if (!prefixes) return false;
  return prefixes.some(prefix => data.startsWith(prefix));
}

export async function convertToOpenAIResponsesInput({
  prompt,
  systemMessageMode,
  fileIdPrefixes,
  store,
  hasLocalShellTool = false,
<<<<<<< HEAD
=======
  hasShellTool = false,
  hasApplyPatchTool = false,
  hasComputerTool = false,
  customProviderToolNames,
>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290))
}: {
  prompt: LanguageModelV2Prompt;
  systemMessageMode: 'system' | 'developer' | 'remove';
  fileIdPrefixes?: readonly string[];
  store: boolean;
  hasLocalShellTool?: boolean;
<<<<<<< HEAD
=======
  hasShellTool?: boolean;
  hasApplyPatchTool?: boolean;
  hasComputerTool?: boolean;
  customProviderToolNames?: Set<string>;
>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290))
}): Promise<{
  input: OpenAIResponsesInput;
  warnings: Array<LanguageModelV2CallWarning>;
}> {
  let input: OpenAIResponsesInput = [];
  const warnings: Array<LanguageModelV2CallWarning> = [];

  for (const { role, content, providerOptions } of prompt) {
    switch (role) {
      case 'system': {
        switch (systemMessageMode) {
          case 'system': {
            const promptCacheBreakpoint =
              getPromptCacheBreakpoint(providerOptions);
            input.push({
              role: 'system',
              content:
                promptCacheBreakpoint == null
                  ? content
                  : [
                      {
                        type: 'input_text',
                        text: content,
                        prompt_cache_breakpoint: promptCacheBreakpoint,
                      },
                    ],
            });
            break;
          }
          case 'developer': {
            const promptCacheBreakpoint =
              getPromptCacheBreakpoint(providerOptions);
            input.push({
              role: 'developer',
              content:
                promptCacheBreakpoint == null
                  ? content
                  : [
                      {
                        type: 'input_text',
                        text: content,
                        prompt_cache_breakpoint: promptCacheBreakpoint,
                      },
                    ],
            });
            break;
          }
          case 'remove': {
            warnings.push({
              type: 'other',
              message: 'system messages are removed for this model',
            });
            break;
          }
          default: {
            const _exhaustiveCheck: never = systemMessageMode;
            throw new Error(
              `Unsupported system message mode: ${_exhaustiveCheck}`,
            );
          }
        }
        break;
      }

      case 'user': {
        input.push({
          role: 'user',
          content: content.map((part, index) => {
            switch (part.type) {
              case 'text': {
                const promptCacheBreakpoint = getPromptCacheBreakpoint(
                  part.providerOptions,
                );
                return {
                  type: 'input_text',
                  text: part.text,
                  ...(promptCacheBreakpoint != null && {
                    prompt_cache_breakpoint: promptCacheBreakpoint,
                  }),
                };
              }
              case 'file': {
                const promptCacheBreakpoint = getPromptCacheBreakpoint(
                  part.providerOptions,
                );
                if (part.mediaType.startsWith('image/')) {
                  const mediaType =
                    part.mediaType === 'image/*'
                      ? 'image/jpeg'
                      : part.mediaType;

                  return {
                    type: 'input_image',
                    ...(part.data instanceof URL
                      ? { image_url: part.data.toString() }
                      : typeof part.data === 'string' &&
                          isFileId(part.data, fileIdPrefixes)
                        ? { file_id: part.data }
                        : {
                            image_url: `data:${mediaType};base64,${convertToBase64(part.data)}`,
                          }),
                    detail: part.providerOptions?.openai?.imageDetail,
                    ...(promptCacheBreakpoint != null && {
                      prompt_cache_breakpoint: promptCacheBreakpoint,
                    }),
                  };
                } else if (part.mediaType === 'application/pdf') {
                  if (part.data instanceof URL) {
                    return {
                      type: 'input_file',
                      file_url: part.data.toString(),
                      ...(promptCacheBreakpoint != null && {
                        prompt_cache_breakpoint: promptCacheBreakpoint,
                      }),
                    };
                  }
                  return {
                    type: 'input_file',
                    ...(typeof part.data === 'string' &&
                    isFileId(part.data, fileIdPrefixes)
                      ? { file_id: part.data }
                      : {
                          filename: part.filename ?? `part-${index}.pdf`,
                          file_data: `data:application/pdf;base64,${convertToBase64(part.data)}`,
                        }),
                    ...(promptCacheBreakpoint != null && {
                      prompt_cache_breakpoint: promptCacheBreakpoint,
                    }),
                  };
                } else {
                  throw new UnsupportedFunctionalityError({
                    functionality: `file part media type ${part.mediaType}`,
                  });
                }
              }
            }
          }),
        });

        break;
      }

      case 'assistant': {
        const reasoningMessages: Record<string, OpenAIResponsesReasoning> = {};
        const toolCallParts: Record<string, LanguageModelV2ToolCallPart> = {};

        for (const part of content) {
          switch (part.type) {
            case 'text': {
              const id = part.providerOptions?.openai?.itemId as
                | string
                | undefined;
              const phase = part.providerOptions?.openai?.phase as
                | 'commentary'
                | 'final_answer'
                | null
                | undefined;

              // item references reduce the payload size
              if (store && id != null) {
                input.push({ type: 'item_reference', id });
                break;
              }

              input.push({
                role: 'assistant',
                content: [{ type: 'output_text', text: part.text }],
                id,
                ...(phase != null && { phase }),
              });

              break;
            }
            case 'tool-call': {
              toolCallParts[part.toolCallId] = part;

              if (part.providerExecuted) {
                break;
              }

              const id = part.providerOptions?.openai?.itemId as
                | string
                | undefined;

<<<<<<< HEAD
              // item references reduce the payload size
              if (store && id != null) {
=======
              // Provider-defined tool calls (local_shell, shell, apply_patch,
              // computer, and custom tools) are stored by the API and can be sent as an
              // `item_reference` to reduce payload size. Plain client-executed
              // function calls must NOT be: the matching `function_call_output`
              // can only reference the call by `call_id` (`call_...`), which
              // the API cannot reconcile with an item id (`fc_...`) or an
              // `item_reference`. Sending either breaks call/output pairing and
              // makes follow-up requests fail with "No tool call found for
              // function call output with call_id", most visibly with parallel
              // tool calls across multiple steps.
              const isProviderDefinedToolCall =
                (hasLocalShellTool && resolvedToolName === 'local_shell') ||
                (hasShellTool && resolvedToolName === 'shell') ||
                (hasApplyPatchTool && resolvedToolName === 'apply_patch') ||
                (hasComputerTool && resolvedToolName === 'computer') ||
                (customProviderToolNames?.has(resolvedToolName) ?? false);

              if (store && id != null && isProviderDefinedToolCall) {
>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290))
                input.push({ type: 'item_reference', id });
                break;
              }

              if (hasLocalShellTool && part.toolName === 'local_shell') {
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: localShellInputSchema,
                });
                input.push({
                  type: 'local_shell_call',
                  call_id: part.toolCallId,
                  id: id!,
                  action: {
                    type: 'exec',
                    command: parsedInput.action.command,
                    timeout_ms: parsedInput.action.timeoutMs,
                    user: parsedInput.action.user,
                    working_directory: parsedInput.action.workingDirectory,
                    env: parsedInput.action.env,
                  },
                });

                break;
              }

<<<<<<< HEAD
=======
              if (hasShellTool && resolvedToolName === 'shell') {
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: shellInputSchema,
                });
                input.push({
                  type: 'shell_call',
                  call_id: part.toolCallId,
                  id: id!,
                  status: 'completed',
                  action: {
                    commands: parsedInput.action.commands,
                    timeout_ms: parsedInput.action.timeoutMs,
                    max_output_length: parsedInput.action.maxOutputLength,
                  },
                });

                break;
              }

              if (hasApplyPatchTool && resolvedToolName === 'apply_patch') {
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: applyPatchInputSchema,
                });
                input.push({
                  type: 'apply_patch_call',
                  call_id: parsedInput.callId,
                  id: id!,
                  status: 'completed',
                  operation: parsedInput.operation,
                });

                break;
              }

              if (hasComputerTool && resolvedToolName === 'computer') {
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: computerInputSchema,
                });
                input.push({
                  type: 'computer_call',
                  call_id: part.toolCallId,
                  id: id!,
                  status: parsedInput.status,
                  actions: parsedInput.actions.map(action => {
                    switch (action.type) {
                      case 'click':
                      case 'double_click':
                      case 'move':
                        return {
                          ...action,
                          keys: action.keys,
                        };
                      case 'drag':
                        return {
                          ...action,
                          keys: action.keys,
                        };
                      case 'scroll':
                        return {
                          type: 'scroll' as const,
                          x: action.x,
                          y: action.y,
                          scroll_x: action.scrollX,
                          scroll_y: action.scrollY,
                          keys: action.keys,
                        };
                      default:
                        return action;
                    }
                  }),
                  pending_safety_checks: parsedInput.pendingSafetyChecks.map(
                    safetyCheck => ({
                      id: safetyCheck.id,
                      code: safetyCheck.code,
                      message: safetyCheck.message,
                    }),
                  ),
                });

                break;
              }

              if (customProviderToolNames?.has(resolvedToolName)) {
                input.push({
                  type: 'custom_tool_call',
                  call_id: part.toolCallId,
                  name: resolvedToolName,
                  input:
                    typeof part.input === 'string'
                      ? part.input
                      : JSON.stringify(part.input),
                  id,
                });
                break;
              }

>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290))
              input.push({
                type: 'function_call',
                call_id: part.toolCallId,
                name: part.toolName,
                arguments: JSON.stringify(part.input),
                id,
              });
              break;
            }

            // assistant tool result parts are from provider-executed tools:
            case 'tool-result': {
              if (store) {
                // use item references to refer to tool results from built-in tools
                input.push({ type: 'item_reference', id: part.toolCallId });
              } else {
                warnings.push({
                  type: 'other',
                  message: `Results for OpenAI tool ${part.toolName} are not sent to the API when store is false`,
                });
              }

              break;
            }

            case 'reasoning': {
              const providerOptions = await parseProviderOptions({
                provider: 'openai',
                providerOptions: part.providerOptions,
                schema: openaiResponsesReasoningProviderOptionsSchema,
              });

              const reasoningId = providerOptions?.itemId;

              if (reasoningId != null) {
                const reasoningMessage = reasoningMessages[reasoningId];

                if (store) {
                  // use item references to refer to reasoning (single reference)
                  // when the first part is encountered
                  if (reasoningMessage === undefined) {
                    input.push({ type: 'item_reference', id: reasoningId });

                    // store unused reasoning message to mark id as used
                    reasoningMessages[reasoningId] = {
                      type: 'reasoning',
                      id: reasoningId,
                      summary: [],
                    };
                  }
                } else {
                  const summaryParts: Array<{
                    type: 'summary_text';
                    text: string;
                  }> = [];

                  if (part.text.length > 0) {
                    summaryParts.push({
                      type: 'summary_text',
                      text: part.text,
                    });
                  } else if (reasoningMessage !== undefined) {
                    warnings.push({
                      type: 'other',
                      message: `Cannot append empty reasoning part to existing reasoning sequence. Skipping reasoning part: ${JSON.stringify(part)}.`,
                    });
                  }

                  if (reasoningMessage === undefined) {
                    reasoningMessages[reasoningId] = {
                      type: 'reasoning',
                      id: reasoningId,
                      encrypted_content:
                        providerOptions?.reasoningEncryptedContent,
                      summary: summaryParts,
                    };
                    input.push(reasoningMessages[reasoningId]);
                  } else {
                    reasoningMessage.summary.push(...summaryParts);

                    // updated encrypted content to enable setting it in the last summary part:
                    if (providerOptions?.reasoningEncryptedContent != null) {
                      reasoningMessage.encrypted_content =
                        providerOptions.reasoningEncryptedContent;
                    }
                  }
                }
              } else {
                warnings.push({
                  type: 'other',
                  message: `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${JSON.stringify(part)}.`,
                });
              }
              break;
            }
          }
        }

        break;
      }

      case 'tool': {
        for (const part of content) {
          const output = part.output;
          const promptCacheBreakpoint = getPromptCacheBreakpoint(
            part.providerOptions,
          );

          if (
            hasLocalShellTool &&
            part.toolName === 'local_shell' &&
            output.type === 'json'
          ) {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: localShellOutputSchema,
            });

            input.push({
              type: 'local_shell_call_output',
              call_id: part.toolCallId,
              output: parsedOutput.output,
            });
<<<<<<< HEAD
            break;
=======
            continue;
          }

          if (
            hasShellTool &&
            resolvedToolName === 'shell' &&
            output.type === 'json'
          ) {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: shellOutputSchema,
            });

            input.push({
              type: 'shell_call_output',
              call_id: part.toolCallId,
              output: parsedOutput.output.map(item => ({
                stdout: item.stdout,
                stderr: item.stderr,
                outcome:
                  item.outcome.type === 'timeout'
                    ? { type: 'timeout' as const }
                    : {
                        type: 'exit' as const,
                        exit_code: item.outcome.exitCode,
                      },
              })),
            });
            continue;
          }

          if (
            hasApplyPatchTool &&
            part.toolName === 'apply_patch' &&
            output.type === 'json'
          ) {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: applyPatchOutputSchema,
            });

            input.push({
              type: 'apply_patch_call_output',
              call_id: part.toolCallId,
              status: parsedOutput.status,
              output: parsedOutput.output,
            });
            continue;
          }

          if (
            hasComputerTool &&
            resolvedToolName === 'computer' &&
            output.type === 'json'
          ) {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: computerOutputSchema,
            });

            input.push({
              type: 'computer_call_output',
              call_id: part.toolCallId,
              output: {
                type: 'computer_screenshot',
                image_url: parsedOutput.output.imageUrl,
                file_id: parsedOutput.output.fileId,
                detail: parsedOutput.output.detail,
              },
              acknowledged_safety_checks:
                parsedOutput.acknowledgedSafetyChecks?.map(safetyCheck => ({
                  id: safetyCheck.id,
                  code: safetyCheck.code,
                  message: safetyCheck.message,
                })),
            });
            continue;
          }

          if (customProviderToolNames?.has(resolvedToolName)) {
            let outputValue: OpenAIResponsesCustomToolCallOutput['output'];
            switch (output.type) {
              case 'text':
              case 'error-text':
                outputValue = output.value;
                break;
              case 'execution-denied':
                outputValue = output.reason ?? 'Tool call execution denied.';
                break;
              case 'json':
              case 'error-json':
                outputValue = JSON.stringify(output.value);
                break;
              case 'content':
                outputValue = output.value
                  .map(item => {
                    const promptCacheBreakpoint = getPromptCacheBreakpoint(
                      item.providerOptions,
                      providerOptionsName,
                    );
                    switch (item.type) {
                      case 'text':
                        return {
                          type: 'input_text' as const,
                          text: item.text,
                          ...(promptCacheBreakpoint != null && {
                            prompt_cache_breakpoint: promptCacheBreakpoint,
                          }),
                        };
                      case 'file': {
                        const topLevel = getTopLevelMediaType(item.mediaType);
                        const imageDetail =
                          item.providerOptions?.[providerOptionsName]
                            ?.imageDetail;

                        if (item.data.type === 'data') {
                          const fullMediaType = resolveFullMediaType({
                            part: item,
                          });
                          if (topLevel === 'image') {
                            return {
                              type: 'input_image' as const,
                              image_url: `data:${fullMediaType};base64,${convertToBase64(item.data.data)}`,
                              detail: imageDetail,
                              ...(promptCacheBreakpoint != null && {
                                prompt_cache_breakpoint: promptCacheBreakpoint,
                              }),
                            };
                          }
                          return {
                            type: 'input_file' as const,
                            filename: item.filename ?? 'data',
                            file_data: `data:${fullMediaType};base64,${convertToBase64(item.data.data)}`,
                            ...(promptCacheBreakpoint != null && {
                              prompt_cache_breakpoint: promptCacheBreakpoint,
                            }),
                          };
                        }

                        if (item.data.type === 'url') {
                          if (topLevel === 'image') {
                            return {
                              type: 'input_image' as const,
                              image_url: item.data.url.toString(),
                              detail: imageDetail,
                              ...(promptCacheBreakpoint != null && {
                                prompt_cache_breakpoint: promptCacheBreakpoint,
                              }),
                            };
                          }
                          return {
                            type: 'input_file' as const,
                            file_url: item.data.url.toString(),
                            ...(promptCacheBreakpoint != null && {
                              prompt_cache_breakpoint: promptCacheBreakpoint,
                            }),
                          };
                        }

                        warnings.push({
                          type: 'other',
                          message: `unsupported custom tool content part type: ${item.type} with data type: ${item.data.type}`,
                        });
                        return undefined;
                      }
                      default:
                        warnings.push({
                          type: 'other',
                          message: `unsupported custom tool content part type: ${item.type}`,
                        });
                        return undefined;
                    }
                  })
                  .filter(isNonNullable);
                break;
              default:
                outputValue = '';
            }
            input.push({
              type: 'custom_tool_call_output',
              call_id: part.toolCallId,
              output: outputValue,
            } satisfies OpenAIResponsesCustomToolCallOutput);
            continue;
>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290))
          }

          let contentValue: OpenAIResponsesFunctionCallOutput['output'];
          switch (output.type) {
            case 'text':
            case 'error-text':
              contentValue =
                promptCacheBreakpoint == null
                  ? output.value
                  : [
                      {
                        type: 'input_text',
                        text: output.value,
                        prompt_cache_breakpoint: promptCacheBreakpoint,
                      },
                    ];
              break;
            case 'json':
            case 'error-json':
              contentValue =
                promptCacheBreakpoint == null
                  ? JSON.stringify(output.value)
                  : [
                      {
                        type: 'input_text',
                        text: JSON.stringify(output.value),
                        prompt_cache_breakpoint: promptCacheBreakpoint,
                      },
                    ];
              break;
            case 'content':
              contentValue = output.value.map((item, index) => {
                const isBreakpoint =
                  promptCacheBreakpoint != null &&
                  index === output.value.length - 1;
                switch (item.type) {
                  case 'text': {
                    return {
                      type: 'input_text' as const,
                      text: item.text,
                      ...(isBreakpoint && {
                        prompt_cache_breakpoint: promptCacheBreakpoint,
                      }),
                    };
                  }
                  case 'media': {
                    return item.mediaType.startsWith('image/')
                      ? {
                          type: 'input_image' as const,
                          image_url: `data:${item.mediaType};base64,${item.data}`,
                          ...(isBreakpoint && {
                            prompt_cache_breakpoint: promptCacheBreakpoint,
                          }),
                        }
                      : {
                          type: 'input_file' as const,
                          filename: 'data',
                          file_data: `data:${item.mediaType};base64,${item.data}`,
                          ...(isBreakpoint && {
                            prompt_cache_breakpoint: promptCacheBreakpoint,
                          }),
                        };
                  }
                }
              });
              break;
          }

          input.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output: contentValue,
          });
        }

        break;
      }

      default: {
        const _exhaustiveCheck: never = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
      }
    }
  }

  // when store is false, remove reasoning parts without encrypted content
  if (
    !store &&
    input.some(
      item =>
        'type' in item &&
        item.type === 'reasoning' &&
        item.encrypted_content == null,
    )
  ) {
    warnings.push({
      type: 'other',
      message:
        'Reasoning parts without encrypted content are not supported when store is false. Skipping reasoning parts.',
    });
    input = input.filter(
      item =>
        !('type' in item) ||
        item.type !== 'reasoning' ||
        item.encrypted_content != null,
    );
  }

  return { input, warnings };
}

const openaiResponsesReasoningProviderOptionsSchema = z.object({
  itemId: z.string().nullish(),
  reasoningEncryptedContent: z.string().nullish(),
});

export type OpenAIResponsesReasoningProviderOptions = z.infer<
  typeof openaiResponsesReasoningProviderOptionsSchema
>;
