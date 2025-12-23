#!/bin/bash

# Quick script to set Lambda environment variables
# This avoids the AWS_REGION reserved variable issue

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

FUNCTION_NAME="wallyweb-contact"
REGION="${AWS_REGION:-us-east-2}"

echo "⚙️  Setting Lambda Environment Variables"
echo "========================================"
echo ""

# Get current values or prompt
read -p "Enter email to RECEIVE contact form submissions (CONTACT_EMAIL): " CONTACT_EMAIL
read -p "Enter email to SEND FROM (EMAIL_FROM): " EMAIL_FROM
read -p "Enter your website domain for CORS (ALLOWED_ORIGIN, e.g., https://wallyweb.com): " ALLOWED_ORIGIN

if [ -z "$CONTACT_EMAIL" ] || [ -z "$EMAIL_FROM" ] || [ -z "$ALLOWED_ORIGIN" ]; then
    echo "❌ All fields are required"
    exit 1
fi

echo ""
echo "📝 Updating environment variables..."
echo "   Note: Using SES_REGION instead of AWS_REGION (AWS_REGION is reserved)"

aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "Variables={
        CONTACT_EMAIL=$CONTACT_EMAIL,
        EMAIL_FROM=$EMAIL_FROM,
        SES_REGION=$REGION,
        ALLOWED_ORIGIN=$ALLOWED_ORIGIN
    }" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --no-cli-pager

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Environment variables updated successfully!"
    echo ""
    echo "📋 Current configuration:"
    aws lambda get-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --query 'Environment.Variables' \
        --output json \
        --no-cli-pager | python3 -m json.tool 2>/dev/null || echo "Check in AWS Console"
else
    echo ""
    echo "❌ Failed to update environment variables"
    exit 1
fi

