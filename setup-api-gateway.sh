#!/bin/bash

# API Gateway Setup Script for WallyWeb Contact Form
# This script helps you set up API Gateway via AWS CLI

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "🚀 API Gateway Setup for WallyWeb Contact Form"
echo "=============================================="
echo ""

# Configuration
API_NAME="wallyweb-api"
RESOURCE_PATH="contact"
LAMBDA_FUNCTION="wallyweb-contact"
REGION="us-east-2"
STAGE_NAME="prod"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-*}"

echo "📋 Configuration:"
echo "   API Name: $API_NAME"
echo "   Resource Path: /$RESOURCE_PATH"
echo "   Lambda Function: $LAMBDA_FUNCTION"
echo "   Region: $REGION"
echo "   Stage: $STAGE_NAME"
echo "   CORS Origin: $ALLOWED_ORIGIN"
echo ""

read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Check if Lambda function exists
echo ""
echo "🔍 Checking Lambda function..."
LAMBDA_EXISTS=$(aws lambda get-function --function-name "$LAMBDA_FUNCTION" --region "$REGION" --profile "$AWS_PROFILE" --no-cli-pager 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ Lambda function '$LAMBDA_FUNCTION' not found"
    echo "   Please deploy it first: ./deploy-lambda.sh"
    exit 1
fi

echo "✅ Lambda function found"
echo ""

# Check if API already exists
echo "🔍 Checking for existing API..."
EXISTING_API=$(aws apigateway get-rest-apis --profile "$AWS_PROFILE" --region us-east-2 --no-cli-pager --query "items[?name=='$API_NAME'].id" --output text 2>&1)

if [ -n "$EXISTING_API" ] && [ "$EXISTING_API" != "None" ]; then
    echo "⚠️  API '$API_NAME' already exists (ID: $EXISTING_API)"
    read -p "Use existing API? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Please delete the existing API or use a different name"
        exit 1
    fi
    API_ID="$EXISTING_API"
else
    echo "📦 Creating REST API..."
    API_ID=$(aws apigateway create-rest-api \
        --name "$API_NAME" \
        --description "API for WallyWeb contact form" \
        --endpoint-configuration types=REGIONAL \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --no-cli-pager \
        --query 'id' \
        --output text 2>&1)
    
    if [ $? -ne 0 ] || [ -z "$API_ID" ]; then
        echo "❌ Failed to create API"
        exit 1
    fi
    
    echo "✅ API created: $API_ID"
fi

# Get root resource ID
echo ""
echo "🔍 Getting root resource..."
ROOT_RESOURCE_ID=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager \
    --query 'items[?path==`/`].id' \
    --output text 2>&1)

if [ -z "$ROOT_RESOURCE_ID" ] || [ "$ROOT_RESOURCE_ID" = "None" ]; then
    echo "❌ Could not get root resource ID"
    exit 1
fi

echo "✅ Root resource ID: $ROOT_RESOURCE_ID"

# Check if resource already exists
echo ""
echo "🔍 Checking for existing resource..."
EXISTING_RESOURCE=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager \
    --query "items[?path=='/$RESOURCE_PATH'].id" \
    --output text 2>&1)

if [ -n "$EXISTING_RESOURCE" ] && [ "$EXISTING_RESOURCE" != "None" ]; then
    echo "⚠️  Resource '/$RESOURCE_PATH' already exists"
    RESOURCE_ID="$EXISTING_RESOURCE"
else
    echo "📦 Creating resource '/$RESOURCE_PATH'..."
    RESOURCE_ID=$(aws apigateway create-resource \
        --rest-api-id "$API_ID" \
        --parent-id "$ROOT_RESOURCE_ID" \
        --path-part "$RESOURCE_PATH" \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --no-cli-pager \
        --query 'id' \
        --output text 2>&1)
    
    if [ $? -ne 0 ] || [ -z "$RESOURCE_ID" ]; then
        echo "❌ Failed to create resource"
        exit 1
    fi
    
    echo "✅ Resource created: $RESOURCE_ID"
fi

# Get Lambda function ARN
LAMBDA_ARN=$(aws lambda get-function \
    --function-name "$LAMBDA_FUNCTION" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager \
    --query 'Configuration.FunctionArn' \
    --output text 2>&1)

# Create or update POST method
echo ""
echo "📦 Setting up POST method..."

# Check if method exists
METHOD_EXISTS=$(aws apigateway get-method \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method POST \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager 2>&1)

if [ $? -eq 0 ]; then
    echo "⚠️  POST method already exists, updating..."
    aws apigateway update-method \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method POST \
        --patch-ops '[{"op":"replace","path":"/httpMethod","value":"POST"},{"op":"replace","path":"/authorizationType","value":"NONE"}]' \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --no-cli-pager > /dev/null
else
    echo "📦 Creating POST method..."
    aws apigateway put-method \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method POST \
        --authorization-type NONE \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --no-cli-pager > /dev/null
fi

# Set up Lambda integration
echo "📦 Setting up Lambda integration..."
aws apigateway put-integration \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method POST \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null

# Grant API Gateway permission to invoke Lambda
echo "📦 Granting API Gateway permission to invoke Lambda..."
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query 'Account' --output text)
SOURCE_ARN="arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*"

# Check if permission already exists
PERMISSION_EXISTS=$(aws lambda get-policy \
    --function-name "$LAMBDA_FUNCTION" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager 2>&1 | grep -q "$API_ID")

if [ $? -ne 0 ]; then
    aws lambda add-permission \
        --function-name "$LAMBDA_FUNCTION" \
        --statement-id "apigateway-invoke-$(date +%s)" \
        --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com \
        --source-arn "$SOURCE_ARN" \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --no-cli-pager > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Permission granted"
    else
        echo "⚠️  Could not grant permission (may already exist)"
    fi
else
    echo "✅ Permission already exists"
fi

# Enable CORS
echo ""
echo "📦 Enabling CORS..."
aws apigateway put-method-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Origin":true,"method.response.header.Access-Control-Allow-Headers":true,"method.response.header.Access-Control-Allow-Methods":true}' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null 2>&1

# Deploy API
echo ""
echo "📦 Deploying API to stage '$STAGE_NAME'..."
DEPLOYMENT_ID=$(aws apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name "$STAGE_NAME" \
    --description "Deployment for WallyWeb contact form" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager \
    --query 'id' \
    --output text 2>&1)

if [ $? -eq 0 ] && [ -n "$DEPLOYMENT_ID" ]; then
    echo "✅ API deployed successfully"
else
    echo "⚠️  Deployment may have failed, but continuing..."
fi

# Get API endpoint URL
ENDPOINT_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE_NAME}/${RESOURCE_PATH}"

echo ""
echo "✅ API Gateway setup complete!"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📋 Your API Endpoint:"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "$ENDPOINT_URL"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📝 Next Steps:"
echo ""
echo "1. Update your website to use this URL:"
echo "   Add to index.html before </body>:"
echo ""
echo "   <script>"
echo "     window.API_URL = '$ENDPOINT_URL';"
echo "   </script>"
echo ""
echo "2. Redeploy your website:"
echo "   ./deploy-s3.sh"
echo ""
echo "3. Test your contact form!"
echo ""
echo "💡 You can also view/manage your API in AWS Console:"
echo "   https://console.aws.amazon.com/apigateway/home?region=$REGION#/apis/$API_ID"
echo ""


