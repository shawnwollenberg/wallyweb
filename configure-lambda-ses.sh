#!/bin/bash

# Script to configure Lambda function with SES settings

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "⚙️  Configuring Lambda function for SES..."
echo ""

# Configuration
FUNCTION_NAME="wallyweb-contact"
REGION="${AWS_REGION:-us-east-2}"

# Prompt for email addresses
read -p "Enter email to RECEIVE contact form submissions (CONTACT_EMAIL): " CONTACT_EMAIL
read -p "Enter email to SEND FROM (EMAIL_FROM, must be verified in SES): " EMAIL_FROM
read -p "Enter your website domain for CORS (e.g., https://wallyweb.com): " ALLOWED_ORIGIN

if [ -z "$CONTACT_EMAIL" ] || [ -z "$EMAIL_FROM" ] || [ -z "$ALLOWED_ORIGIN" ]; then
    echo "❌ All fields are required"
    exit 1
fi

echo ""
echo "🔍 Verifying email addresses in SES..."

# Check if CONTACT_EMAIL is verified (optional, but recommended)
CONTACT_VERIFIED=$(aws ses get-identity-verification-attributes \
    --identities "$CONTACT_EMAIL" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query "VerificationAttributes.$CONTACT_EMAIL.VerificationStatus" \
    --output text \
    --no-cli-pager 2>&1)

if [ "$CONTACT_VERIFIED" != "Success" ]; then
    echo "⚠️  Warning: $CONTACT_EMAIL is not verified in SES"
    echo "   You should verify it, but it's not required to receive emails"
fi

# Check if EMAIL_FROM is verified (required)
FROM_VERIFIED=$(aws ses get-identity-verification-attributes \
    --identities "$EMAIL_FROM" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query "VerificationAttributes.$EMAIL_FROM.VerificationStatus" \
    --output text \
    --no-cli-pager 2>&1)

if [ "$FROM_VERIFIED" != "Success" ]; then
    echo "❌ Error: $EMAIL_FROM is not verified in SES"
    echo "   You must verify this email/domain before sending emails"
    echo ""
    echo "   To verify, run:"
    echo "   ./verify-ses-email.sh $EMAIL_FROM"
    echo "   Or verify in AWS Console:"
    echo "   https://console.aws.amazon.com/ses/home?region=$REGION#/verified-identities"
    exit 1
fi

echo "✅ $EMAIL_FROM is verified"
echo ""

# Check if Lambda function exists
echo "🔍 Checking Lambda function..."
FUNCTION_EXISTS=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" --profile "$AWS_PROFILE" --no-cli-pager 2>&1)

if [ $? -ne 0 ]; then
    echo "⚠️  Lambda function '$FUNCTION_NAME' doesn't exist yet"
    echo "   You'll need to create it first using deploy-lambda.sh"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Update environment variables
echo "📝 Updating Lambda environment variables..."

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
    echo "✅ Lambda function configured successfully!"
    echo ""
    echo "📋 Configuration:"
    echo "   Function: $FUNCTION_NAME"
    echo "   Contact Email: $CONTACT_EMAIL"
    echo "   From Email: $EMAIL_FROM"
    echo "   Region: $REGION"
    echo "   Allowed Origin: $ALLOWED_ORIGIN"
    echo ""
    echo "🔐 Make sure your Lambda execution role has SES permissions:"
    echo "   - Go to Lambda Console → $FUNCTION_NAME → Configuration → Permissions"
    echo "   - Click on the execution role"
    echo "   - Add policy: AmazonSESFullAccess (or custom policy with ses:SendEmail)"
    echo ""
    echo "🧪 Test your contact form now!"
else
    echo ""
    echo "❌ Failed to update Lambda function"
    exit 1
fi

