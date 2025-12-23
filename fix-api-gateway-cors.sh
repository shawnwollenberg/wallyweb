#!/bin/bash

# Script to fix CORS configuration in API Gateway

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "🔧 Fixing API Gateway CORS Configuration"
echo "=========================================="
echo ""

REGION="us-east-2"
API_NAME="wallyweb-api"
RESOURCE_PATH="contact"
ALLOWED_ORIGIN="https://wallyweb.com"

# Get API ID
echo "🔍 Finding API..."
API_ID=$(aws apigateway get-rest-apis --profile "$AWS_PROFILE" --region "$REGION" --no-cli-pager --query "items[?name=='$API_NAME'].id" --output text 2>&1)

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
    echo "❌ API '$API_NAME' not found"
    echo "   Please run ./setup-api-gateway.sh first"
    exit 1
fi

echo "✅ Found API: $API_ID"

# Get resource ID
echo ""
echo "🔍 Finding resource..."
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

# Check if OPTIONS method exists
echo ""
echo "🔍 Checking OPTIONS method..."
OPTIONS_EXISTS=$(aws apigateway get-method \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method OPTIONS \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager 2>&1)

if [ $? -ne 0 ]; then
    echo "📦 Creating OPTIONS method..."
    
    # Create OPTIONS method
    aws apigateway put-method \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method OPTIONS \
        --authorization-type NONE \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --no-cli-pager > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ OPTIONS method created"
    else
        echo "❌ Failed to create OPTIONS method"
        exit 1
    fi
else
    echo "✅ OPTIONS method already exists"
fi

# Set up OPTIONS method response
echo ""
echo "📦 Configuring OPTIONS method response..."
aws apigateway put-method-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{
        "method.response.header.Access-Control-Allow-Origin": true,
        "method.response.header.Access-Control-Allow-Headers": true,
        "method.response.header.Access-Control-Allow-Methods": true
    }' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null

# Set up MOCK integration for OPTIONS
echo "📦 Setting up MOCK integration for OPTIONS..."
aws apigateway put-integration \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method OPTIONS \
    --type MOCK \
    --request-templates '{"application/json":"{\"statusCode\":200}"}' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null

# Set up integration response for OPTIONS
echo "📦 Configuring OPTIONS integration response..."
aws apigateway put-integration-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{
        "method.response.header.Access-Control-Allow-Origin": "'"'"'$ALLOWED_ORIGIN'"'"'",
        "method.response.header.Access-Control-Allow-Headers": "'"'"'Content-Type'"'"'",
        "method.response.header.Access-Control-Allow-Methods": "'"'"'POST,OPTIONS'"'"'"
    }' \
    --response-templates '{"application/json":""}' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null

# Update POST method response to include CORS headers
echo ""
echo "📦 Updating POST method response with CORS headers..."
aws apigateway put-method-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method POST \
    --status-code 200 \
    --response-parameters '{
        "method.response.header.Access-Control-Allow-Origin": true
    }' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null 2>&1

# Update POST integration response
echo "📦 Updating POST integration response..."
aws apigateway put-integration-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RESOURCE_ID" \
    --http-method POST \
    --status-code 200 \
    --response-parameters '{
        "method.response.header.Access-Control-Allow-Origin": "'"'"'$ALLOWED_ORIGIN'"'"'"
    }' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager > /dev/null 2>&1

# Deploy API
echo ""
echo "📦 Redeploying API..."
DEPLOYMENT_ID=$(aws apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name prod \
    --description "CORS fix deployment" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager \
    --query 'id' \
    --output text 2>&1)

if [ $? -eq 0 ] && [ -n "$DEPLOYMENT_ID" ]; then
    echo "✅ API redeployed successfully"
else
    echo "⚠️  Deployment may have issues, but continuing..."
fi

echo ""
echo "✅ CORS configuration complete!"
echo ""
echo "📋 Configuration:"
echo "   Allowed Origin: $ALLOWED_ORIGIN"
echo "   Allowed Headers: Content-Type"
echo "   Allowed Methods: POST, OPTIONS"
echo ""
echo "🧪 Test your contact form now!"
echo ""
echo "💡 If you still see CORS errors:"
echo "   1. Wait 30-60 seconds for changes to propagate"
echo "   2. Hard refresh your browser (Cmd+Shift+R)"
echo "   3. Check that ALLOWED_ORIGIN in Lambda matches your website URL"
echo ""

