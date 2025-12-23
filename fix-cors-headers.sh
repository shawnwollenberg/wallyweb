#!/bin/bash

# Fix CORS headers - replace $ALLOWED_ORIGIN with actual value

export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"
REGION="us-east-2"
API_NAME="wallyweb-api"
RESOURCE_PATH="contact"
ALLOWED_ORIGIN="https://wallyweb.com"

echo "🔧 Fixing CORS Headers in API Gateway"
echo "======================================"
echo ""

# Get API ID
API_ID=$(aws apigateway get-rest-apis --profile "$AWS_PROFILE" --region "$REGION" --no-cli-pager --query "items[?name=='$API_NAME'].id" --output text 2>&1)

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
    echo "❌ API '$API_NAME' not found"
    exit 1
fi

echo "✅ Found API: $API_ID"

# Get resource ID
RESOURCE_ID=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager \
    --query "items[?path=='/$RESOURCE_PATH'].id" \
    --output text 2>&1)

if [ -z "$RESOURCE_ID" ] || [ "$RESOURCE_ID" = "None" ]; then
    echo "❌ Resource '/$RESOURCE_PATH' not found"
    exit 1
fi

echo "✅ Found resource: $RESOURCE_ID"
echo ""

# Fix OPTIONS integration response
echo "📦 Fixing OPTIONS integration response..."
aws apigateway put-integration-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters "{
        \"method.response.header.Access-Control-Allow-Origin\": \"'$ALLOWED_ORIGIN'\",
        \"method.response.header.Access-Control-Allow-Headers\": \"'Content-Type'\",
        \"method.response.header.Access-Control-Allow-Methods\": \"'POST,OPTIONS'\"
    }" \
    --response-templates '{"application/json":""}' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null

if [ $? -eq 0 ]; then
    echo "✅ OPTIONS integration response fixed"
else
    echo "❌ Failed to fix OPTIONS integration response"
fi

# Fix POST integration response
echo "📦 Fixing POST integration response..."
aws apigateway put-integration-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method POST \
    --status-code 200 \
    --response-parameters "{
        \"method.response.header.Access-Control-Allow-Origin\": \"'$ALLOWED_ORIGIN'\"
    }" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✅ POST integration response fixed"
else
    echo "⚠️  POST integration response may not exist (this is OK if using Lambda proxy)"
fi

# Deploy API
echo ""
echo "📦 Redeploying API..."
DEPLOYMENT_ID=$(aws apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name prod \
    --description "CORS headers fix - $(date +%Y-%m-%d)" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager \
    --query 'id' \
    --output text 2>&1)

if [ $? -eq 0 ] && [ -n "$DEPLOYMENT_ID" ]; then
    echo "✅ API redeployed successfully"
    echo "   Deployment ID: $DEPLOYMENT_ID"
else
    echo "⚠️  Deployment may have issues"
fi

echo ""
echo "✅ CORS headers fixed!"
echo ""
echo "📋 Configuration:"
echo "   Allowed Origin: $ALLOWED_ORIGIN"
echo ""
echo "🧪 Test your contact form now!"
echo "   Wait 10-30 seconds for changes to propagate, then hard refresh (Cmd+Shift+R)"
echo ""

