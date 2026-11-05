import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerTelemetry } from 'ai';

/** What {@link startTracing} needs. The keys are read from SSM in production. */
export interface TracingOptions {
  readonly publicKey: string;
  readonly secretKey: string;
  /** The Langfuse region's URL (`https://cloud.langfuse.com` for the EU). */
  readonly baseUrl: string;
  /** Local runs share production's Langfuse project, so this tells their traces apart. */
  readonly environment: 'production' | 'local' | 'evals';
}

/** Sends the spans still waiting. Never throws, and gives up after a short while. */
export type FlushTraces = () => Promise<void>;

// A trace is worth less than the answer a player is waiting for.
const flushTimeoutMs = 2000;

/**
 * Starts tracing every narrator call in Langfuse. Call it once per process, and call the function it
 * returns before a Lambda returns: its environment may freeze with the spans unsent.
 */
export function startTracing(options: TracingOptions): FlushTraces {
  const processor = new LangfuseSpanProcessor({
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    baseUrl: options.baseUrl,
    environment: options.environment,
    // Each span leaves as it ends: a batch would wait for a timer that a frozen Lambda never runs.
    exportMode: 'immediate',
  });
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());

  return async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        processor.forceFlush(),
        new Promise((resolve) => {
          timer = setTimeout(resolve, flushTimeoutMs);
        }),
      ]);
    } catch (error) {
      console.warn({
        message: 'traces not sent',
        error: error instanceof Error ? error.name : 'unknown',
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
