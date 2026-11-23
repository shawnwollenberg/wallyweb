import * as cdk from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

export class CompassStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const payTo = process.env.MY_WALLET_ADDRESS;
    const cdpApiKeyId = process.env.CDP_API_KEY_ID;
    const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET;
    const rootDomain = process.env.ROOT_DOMAIN || "wallyweb.com";
    const customDomain = process.env.CUSTOM_DOMAIN || `compass.${rootDomain}`;
    const facilitatorUrl = process.env.X402_FACILITATOR_URL || "https://api.cdp.coinbase.com/platform/v2/x402";
    const devBypass = process.env.X402_DEV_BYPASS === "true" || process.env.X402_DEV_BYPASS === "1";
    const allowNonCdpFacilitator = process.env.X402_ALLOW_NON_CDP_FACILITATOR === "true";

    if (!payTo) {
      throw new Error("MY_WALLET_ADDRESS must be set in .env before deploying");
    }

    if (!devBypass && !allowNonCdpFacilitator) {
      const facilitatorHost = new URL(facilitatorUrl).hostname;
      if (!facilitatorHost.endsWith("cdp.coinbase.com")) {
        throw new Error(
          `X402_FACILITATOR_URL must be the Coinbase CDP facilitator so settlements qualify for x402 Bazaar discovery. Got ${facilitatorUrl}.`
        );
      }
      if (!cdpApiKeyId || !cdpApiKeySecret) {
        throw new Error(
          "CDP_API_KEY_ID and CDP_API_KEY_SECRET must be set before deploying. They authenticate verify and settle calls to the CDP facilitator."
        );
      }
    }

    const apiLogGroup = new logs.LogGroup(this, "CompassApiLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const api = new NodejsFunction(this, "CompassApiFunction", {
      entry: "src/lambda.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 1024,
      logGroup: apiLogGroup,
      bundling: {
        format: OutputFormat.CJS,
        target: "node22",
        mainFields: ["module", "main"],
        sourceMap: true
      },
      environment: {
        MY_WALLET_ADDRESS: payTo,
        X402_DEV_BYPASS: process.env.X402_DEV_BYPASS || "false",
        X402_RECOMMEND_PRICE_USD: process.env.X402_RECOMMEND_PRICE_USD || "0.005",
        X402_NETWORK: process.env.X402_NETWORK || "eip155:8453",
        X402_FACILITATOR_URL: facilitatorUrl,
        PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || `https://${customDomain}`,
        BASE_RPC_URL: process.env.BASE_RPC_URL || "https://mainnet.base.org",
        COMPASS_CATALOG_TTL_SECONDS: process.env.COMPASS_CATALOG_TTL_SECONDS || "3600",
        COMPASS_CATALOG_MAX_RESOURCES: process.env.COMPASS_CATALOG_MAX_RESOURCES || "50000",
        COMPASS_CATALOG_BUDGET_MS: process.env.COMPASS_CATALOG_BUDGET_MS || "25000",
        COMPASS_ACTIVITY_LOOKBACK_BLOCKS: process.env.COMPASS_ACTIVITY_LOOKBACK_BLOCKS || "8000",
        COMPASS_ACTIVITY_ENRICH_LIMIT: process.env.COMPASS_ACTIVITY_ENRICH_LIMIT || "12",
        COMPASS_ACTIVITY_TIMEOUT_MS: process.env.COMPASS_ACTIVITY_TIMEOUT_MS || "8000",
        ...(cdpApiKeyId ? { CDP_API_KEY_ID: cdpApiKeyId } : {}),
        ...(cdpApiKeySecret ? { CDP_API_KEY_SECRET: cdpApiKeySecret } : {})
      }
    });

    const functionUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedHeaders: ["content-type", "payment-signature", "x-payment"],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.HEAD],
        exposedHeaders: ["payment-required", "payment-response", "x-payment-required", "x-payment-response"]
      }
    });

    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: rootDomain
    });

    const certificate = new acm.DnsValidatedCertificate(this, "CompassCertificate", {
      domainName: customDomain,
      hostedZone,
      region: "us-east-1"
    });

    const distribution = new cloudfront.Distribution(this, "CompassDistribution", {
      domainNames: [customDomain],
      certificate,
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(functionUrl, {
          readTimeout: Duration.seconds(60),
          keepaliveTimeout: Duration.seconds(60)
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      }
    });

    new route53.ARecord(this, "CompassAliasRecord", {
      zone: hostedZone,
      recordName: customDomain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
    });

    new route53.AaaaRecord(this, "CompassAliasIpv6Record", {
      zone: hostedZone,
      recordName: customDomain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
    });

    new cdk.CfnOutput(this, "CompassApiUrl", { value: functionUrl.url });
    new cdk.CfnOutput(this, "CompassUrl", { value: `https://${customDomain}` });
  }
}
