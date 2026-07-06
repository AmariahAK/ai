import { z } from 'zod/v4';
import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils';

export const cartesiaErrorDataSchema = z.object({
  error: z.string(),
});

export type CartesiaErrorData = z.infer<typeof cartesiaErrorDataSchema>;

export const cartesiaFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: cartesiaErrorDataSchema,
  errorToMessage: data => data.error,
});
