#!/bin/bash

# Script to create an IAM user for SES access
# This is only needed if you're running the Express server (not Lambda)

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "🔐 Creating IAM User for SES Access"
echo "===================================="
echo ""
echo "⚠️  NOTE: This is only needed if you're running the Express server"
echo "   (server.js) locally or on EC2."
echo ""
echo "   If you're using Lambda, you DON'T need this - Lambda uses IAM roles."
echo ""

read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

USER_NAME="wallyweb-ses-sender"

echo ""
echo "📋 Creating IAM user: $USER_NAME"

# Check if user already exists
EXISTING_USER=$(aws iam get-user --user-name "$USER_NAME" --profile "$AWS_PROFILE" 2>&1)
if [ $? -eq 0 ]; then
    echo "⚠️  User $USER_NAME already exists"
    read -p "Create new access key for existing user? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping user creation. Listing existing access keys..."
        aws iam list-access-keys --user-name "$USER_NAME" --profile "$AWS_PROFILE"
        exit 0
    fi
else
    # Create the user
    aws iam create-user --user-name "$USER_NAME" --profile "$AWS_PROFILE"
    
    if [ $? -ne 0 ]; then
        echo "❌ Failed to create user"
        exit 1
    fi
    
    echo "✅ User created"
fi

# Attach SES policy
echo ""
echo "📋 Attaching SES permissions..."
aws iam attach-user-policy \
    --user-name "$USER_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSESFullAccess \
    --profile "$AWS_PROFILE"

if [ $? -eq 0 ]; then
    echo "✅ SES permissions attached"
else
    echo "❌ Failed to attach policy"
    exit 1
fi

# Create access key
echo ""
echo "📋 Creating access key..."
ACCESS_KEY_OUTPUT=$(aws iam create-access-key \
    --user-name "$USER_NAME" \
    --profile "$AWS_PROFILE" \
    --output json)

if [ $? -eq 0 ]; then
    ACCESS_KEY_ID=$(echo "$ACCESS_KEY_OUTPUT" | grep -o '"AccessKeyId": "[^"]*"' | cut -d'"' -f4)
    SECRET_ACCESS_KEY=$(echo "$ACCESS_KEY_OUTPUT" | grep -o '"SecretAccessKey": "[^"]*"' | cut -d'"' -f4)
    
    echo "✅ Access key created!"
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "🔑 IMPORTANT: Save these credentials securely!"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "AWS_ACCESS_KEY_ID=$ACCESS_KEY_ID"
    echo "AWS_SECRET_ACCESS_KEY=$SECRET_ACCESS_KEY"
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "📝 Add these to your .env file:"
    echo ""
    echo "AWS_SES_REGION=us-east-2"
    echo "AWS_ACCESS_KEY_ID=$ACCESS_KEY_ID"
    echo "AWS_SECRET_ACCESS_KEY=$SECRET_ACCESS_KEY"
    echo "EMAIL_FROM=noreply@wallyweb.com"
    echo "CONTACT_EMAIL=contact@wallyweb.com"
    echo ""
    echo "⚠️  Keep these credentials secret! Never commit them to git."
    echo ""
else
    echo "❌ Failed to create access key"
    exit 1
fi


