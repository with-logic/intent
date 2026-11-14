/**
 * Per-test limit for tests that call the live Cerebras API, in milliseconds.
 *
 * The SDK waits up to 60 s before it retries a rate-limited request, so a limit of 120 s lets one
 * such wait finish without failing the test.
 */
export const CEREBRAS_INTEGRATION_TEST_TIMEOUT_MS = 120_000;
