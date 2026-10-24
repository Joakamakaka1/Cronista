import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccessAnalyzerStack } from './access-analyzer-stack.ts';

let analyzer: Template;

beforeAll(() => {
  const app = new App({ context: cdkConfig.context });
  const stack = new AccessAnalyzerStack(app, 'Analyzer', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  analyzer = Template.fromStack(stack);
});

describe('AccessAnalyzerStack', () => {
  it('creates the one account analyzer a region allows', () => {
    analyzer.resourceCountIs('AWS::AccessAnalyzer::Analyzer', 1);
    analyzer.hasResourceProperties('AWS::AccessAnalyzer::Analyzer', { Type: 'ACCOUNT' });
  });
});
