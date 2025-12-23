#!/bin/bash

# AWS Lambda Deployment Script for WallyWeb Contact Form
# Make sure you have AWS CLI configured: aws configure

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "🚀 Deploying WallyWeb Lambda function..."
echo "📋 Using AWS Profile: $AWS_PROFILE"

# Verify account before proceeding
echo "🔍 Verifying AWS account..."
ACCOUNT_INFO=$(aws sts get-caller-identity --profile "$AWS_PROFILE" 2>&1)
if [ $? -ne 0 ]; then
    echo "❌ Error: Could not verify AWS account. Check your profile configuration."
    echo "$ACCOUNT_INFO"
    exit 1
fi

ACCOUNT_ID=$(echo "$ACCOUNT_INFO" | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
echo "✅ Using AWS Account: $ACCOUNT_ID"
echo "⚠️  Please verify this is the correct account before proceeding!"
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled."
    exit 1
fi

# Configuration
FUNCTION_NAME="wallyweb-contact"
REGION="${AWS_REGION:-us-east-2}"
ZIP_FILE="contact-lambda.zip"

# Navigate to lambda directory
cd lambda || exit 1

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Create deployment package
echo "📦 Creating deployment package..."
zip -r ../$ZIP_FILE . -x "*.git*" "*.DS_Store*" "node_modules/.cache/*"

# Check if function exists
FUNCTION_EXISTS=$(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION --profile "$AWS_PROFILE" --no-cli-pager 2>&1)

if [ $? -eq 0 ]; then
    echo "✅ Function exists, updating..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://../$ZIP_FILE \
        --region $REGION \
        --profile "$AWS_PROFILE" \
        --no-cli-pager \
        --output json > /dev/null
else
    echo "📦 Function doesn't exist. Creating it now..."
    
    # Check if role exists
    ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/lambda-execution-role"
    ROLE_EXISTS=$(aws iam get-role --role-name lambda-execution-role --profile "$AWS_PROFILE" 2>&1)
    
    if [ $? -ne 0 ]; then
        echo "⚠️  IAM role 'lambda-execution-role' doesn't exist."
        echo "   Run ./create-lambda-role.sh first to create it."
        exit 1
    fi
    
    echo "📋 Using role: $ROLE_ARN"
    echo ""
    
    # Create the function
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs18.x \
        --role "$ROLE_ARN" \
        --handler contact.handler \
        --zip-file fileb://../$ZIP_FILE \
        --region $REGION \
        --profile "$AWS_PROFILE" \
        --timeout 30 \
        --memory-size 256 \
        --no-cli-pager \
        --output json > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Function created successfully!"
        echo ""
        echo "💡 Don't forget to set environment variables:"
        echo "   Run: ./configure-lambda-ses.sh"
        echo ""
        echo "   Or manually:"
        echo "   aws lambda update-function-configuration \\"
        echo "     --function-name $FUNCTION_NAME \\"
        echo "     --environment Variables='{CONTACT_EMAIL=contact@yourdomain.com,EMAIL_FROM=noreply@yourdomain.com,AWS_REGION=$REGION,ALLOWED_ORIGIN=https://yourdomain.com}' \\"
        echo "     --region $REGION \\"
        echo "     --profile $AWS_PROFILE"
    else
        echo "❌ Failed to create function"
        exit 1
    fi
fi

# Cleanup
cd ..
rm -f $ZIP_FILE

echo "✅ Deployment complete!"

