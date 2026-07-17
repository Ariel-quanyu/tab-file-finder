import { runIntegrationTests } from './suite/quickpick.integration.test';

export function run(): Promise<void> {
  return runIntegrationTests();
}
