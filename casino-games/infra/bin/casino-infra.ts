#!/usr/bin/env node
import '@cspotcode/source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { CasinoInfraStack } from '../lib/casino-infra-stack';

const app = new cdk.App();

new CasinoInfraStack(app, 'CasinoInfraStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-2',
  },
});
