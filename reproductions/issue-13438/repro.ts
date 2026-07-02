import { createOpenResponses } from '@ai-sdk/open-responses';
import type { Provider } from 'ai';

// Expected to type-check if ai.Provider matches @ai-sdk/provider.ProviderV3.
// Currently fails because ai.Provider requires rerankingModel while OpenResponsesProvider
// inherits ProviderV3 where rerankingModel is optional.
const provider: Provider = createOpenResponses({
  name: 'test',
  url: 'http://localhost/v1/responses',
});

console.log(provider);
