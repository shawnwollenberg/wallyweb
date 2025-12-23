#!/bin/bash

# AWS SES Setup Helper Script
# This script helps you set up SES for the WallyWeb contact form

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "🚀 AWS SES Setup Helper for WallyWeb"
echo "===================================="
echo ""

# Check if AWS CLI is configured
echo "🔍 Checking AWS configuration..."
ACCOUNT_INFO=$(aws sts get-caller-identity --profile "$AWS_PROFILE" 2>&1)
if [ $? -ne 0 ]; then
    echo "❌ Error: AWS CLI not configured or profile not found"
    echo "Run: aws configure --profile wallyweb"
    exit 1
fi

ACCOUNT_ID=$(echo "$ACCOUNT_INFO" | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
echo "✅ Using AWS Account: $ACCOUNT_ID"
echo ""

# Get region
REGION="${AWS_REGION:-us-east-2}"
echo "📍 Region: $REGION"
echo ""

# Check SES service status
echo "📧 Checking SES status..."
SES_STATUS=$(aws ses get-account-sending-enabled --region "$REGION" --profile "$AWS_PROFILE" 2>&1)

if echo "$SES_STATUS" | grep -q "AccountSendingEnabled"; then
    SENDING_ENABLED=$(echo "$SES_STATUS" | grep -o '"AccountSendingEnabled": [^,}]*' | cut -d' ' -f2)
    if [ "$SENDING_ENABLED" = "true" ]; then
        echo "✅ SES sending is enabled"
    else
        echo "⚠️  SES sending is disabled"
    fi
else
    echo "ℹ️  Could not determine SES status (this is normal for new accounts)"
fi

# Check sandbox status
echo ""
echo "📋 Checking sandbox status..."
SEND_QUOTA=$(aws ses get-send-quota --region "$REGION" --profile "$AWS_PROFILE" 2>&1)

if echo "$SEND_QUOTA" | grep -q "Max24HourSend"; then
    MAX_SEND=$(echo "$SEND_QUOTA" | grep -o '"Max24HourSend": [^,}]*' | cut -d' ' -f2)
    if [ "$MAX_SEND" = "200" ]; then
        echo "⚠️  Account is in SANDBOX mode (200 emails/day limit)"
        echo "   You can only send to verified email addresses"
        echo "   Request production access in AWS Console to send to any address"
    else
        echo "✅ Account is in PRODUCTION mode"
    fi
else
    echo "ℹ️  Could not determine sandbox status"
fi

# List verified identities
echo ""
echo "📋 Verified Email Addresses and Domains:"
VERIFIED=$(aws ses list-identities --region "$REGION" --profile "$AWS_PROFILE" --query 'Identities' --output text 2>&1)

if [ -n "$VERIFIED" ] && [ "$VERIFIED" != "None" ]; then
    echo "$VERIFIED" | while read identity; do
        if [ -n "$identity" ]; then
            VERIFICATION_STATUS=$(aws ses get-identity-verification-attributes \
                --identities "$identity" \
                --region "$REGION" \
                --profile "$AWS_PROFILE" \
                --query "VerificationAttributes.$identity.VerificationStatus" \
                --output text 2>&1)
            
            if [ "$VERIFICATION_STATUS" = "Success" ]; then
                echo "  ✅ $identity"
            else
                echo "  ⏳ $identity (pending verification)"
            fi
        fi
    done
else
    echo "  ⚠️  No verified identities found"
    echo ""
    echo "  To verify an email address:"
    echo "  1. Go to AWS Console → SES → Verified identities"
    echo "  2. Click 'Create identity'"
    echo "  3. Choose 'Email address' or 'Domain'"
    echo "  4. Follow the verification steps"
fi

echo ""
echo "📝 Next Steps:"
echo "=============="
echo ""
echo "1. Verify your email address or domain in AWS SES Console:"
echo "   https://console.aws.amazon.com/ses/home?region=$REGION#/verified-identities"
echo ""
echo "2. If in sandbox mode, request production access:"
echo "   https://console.aws.amazon.com/ses/home?region=$REGION#/account"
echo ""
echo "3. Configure your Lambda function or server with:"
echo "   - CONTACT_EMAIL: Your email to receive form submissions"
echo "   - EMAIL_FROM: Verified email/domain to send from"
echo "   - AWS_REGION: $REGION"
echo ""
echo "4. Test your contact form!"
echo ""
echo "📖 For detailed instructions, see: ses-setup-guide.md"


