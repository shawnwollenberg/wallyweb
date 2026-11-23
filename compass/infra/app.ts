import dotenv from "dotenv";
import * as cdk from "aws-cdk-lib";
import { CompassStack } from "./compass-stack.js";

dotenv.config({ quiet: true });

const app = new cdk.App();

new CompassStack(app, "X402CompassStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.DEPLOY_REGION || process.env.AWS_REGION || "us-east-2"
  }
});
