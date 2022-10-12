#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsStepfunctionHolidayBookingCdkStack } from '../lib/aws-stepfunction-holiday-booking-cdk-stack';

const app = new cdk.App();
new AwsStepfunctionHolidayBookingCdkStack(
  app,
  'AwsStepfunctionHolidayBookingCdkStack',
  {}
);
