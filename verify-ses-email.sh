#!/bin/bash

# Script to verify an email address in SES

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"
REGION="${AWS_REGION:-us-east-2}"

if [ -z "$1" ]; then
    echo "Usage: ./verify-ses-email.sh <email-address>"
    echo "Example: ./verify-ses-email.sh contact@wallyweb.com"
    exit 1
fi

EMAIL="$1"

echo "📧 Verifying email address: $EMAIL"
echo ""

# Verify the email
aws ses verify-email-identity \
    --email-address "$EMAIL" \
    --region "$REGION" \
    --profile "$AWS_PROFILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Verification email sent to $EMAIL"
    echo ""
    echo "📬 Next steps:"
    echo "1. Check your inbox for an email from AWS"
    echo "2. Click the verification link in the email"
    echo "3. Once verified, you can use this email to send/receive emails via SES"
    echo ""
    echo "💡 You can check verification status with:"
    echo "   aws ses get-identity-verification-attributes --identities $EMAIL --region $REGION --profile $AWS_PROFILE"
else
    echo ""
    echo "❌ Failed to send verification email. Check your AWS permissions and try again."
    exit 1
fi


